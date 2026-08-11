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
      if (requestId !== latestRequestId) return { status: "superseded" } as const;
      onError(error);
      return { error, status: "failed" } as const;
    }

    if (requestId !== latestRequestId) return { status: "superseded" } as const;
    onSuccess(result);
    return { status: "success" } as const;
  };
}
