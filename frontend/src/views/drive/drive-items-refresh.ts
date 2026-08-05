export function createLatestDriveItemsRequestRunner() {
  let latestRequestId = 0;

  return async function runLatestDriveItemsRequest<T>(
    request: () => Promise<T>,
    onSuccess: (result: T) => void,
    onError: (error: unknown) => void,
  ) {
    const requestId = ++latestRequestId;
    let result: T;

    try {
      result = await request();
    } catch (error) {
      if (requestId !== latestRequestId) return false;
      onError(error);
      return false;
    }

    if (requestId !== latestRequestId) return false;
    onSuccess(result);
    return true;
  };
}
