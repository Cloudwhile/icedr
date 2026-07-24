# 传输任务状态机

ICEDR 使用同一套生命周期语义描述上传、下载意图、预览产物、传输任务和存储对象校验任务。不同资源仍保留各自的业务字段，但客户端应以响应中的 `lifecycle` 对象判断任务状态、失败原因和是否适合重试。

## 生命周期对象

相关 API 响应包含以下嵌套对象：

```json
{
  "lifecycle": {
    "status": "running",
    "errorCode": null,
    "errorMessage": null,
    "retryable": false,
    "createdAt": "2026-07-18T04:00:00.000Z",
    "updatedAt": "2026-07-18T04:00:05.000Z",
    "expiresAt": "2026-07-19T04:00:00.000Z"
  }
}
```

| 字段 | 含义 |
| --- | --- |
| `status` | 规范化后的任务状态 |
| `errorCode` | 结构化失败原因；没有失败时为 `null` |
| `errorMessage` | 可选的补充说明；没有说明时为 `null` |
| `retryable` | 失败原因是否适合重试，不表示当前任务一定允许原地恢复 |
| `createdAt` | 任务创建时间，ISO 8601 格式 |
| `updatedAt` | 最近一次状态或进度更新时间，ISO 8601 格式 |
| `expiresAt` | 到期时间，ISO 8601 格式；不会到期时为 `null` |

任务所属用户、文件节点、对象键和进度等信息仍由对应资源的外层字段提供，不会重复放入 `lifecycle`。

## 规范状态

| 状态 | 含义 |
| --- | --- |
| `pending` | 已创建，等待执行或等待所需资源 |
| `running` | 正在执行或正在传输 |
| `paused` | 已暂停，允许在有效期内继续 |
| `completed` | 已成功完成，不再改变 |
| `failed` | 执行失败；能否重试由 `retryable` 和任务类型共同决定 |
| `expired` | 已超过有效期，不得恢复原任务 |
| `canceled` | 已取消，不得恢复原任务 |

并非每一种任务都会使用所有状态。例如，存储对象校验任务只会使用 `running`、`completed` 和 `failed`，但这些值的含义与其他任务一致。

## 合法状态转移

重复写入同一状态视为幂等操作。除此以外，只允许下表中的转移：

| 当前状态 | 可转移到 |
| --- | --- |
| `pending` | `running`、`completed`、`failed`、`expired`、`canceled` |
| `running` | `paused`、`completed`、`failed`、`expired`、`canceled` |
| `paused` | `running`、`failed`、`expired`、`canceled` |
| `failed` | `pending`、`running`、`expired`、`canceled` |
| `completed` | 无 |
| `expired` | 无 |
| `canceled` | 无 |

`completed`、`expired` 和 `canceled` 是终态。并发请求尝试执行非法转移时，服务会保留已提交的状态；传输更新接口会返回 `409` 和 `TRANSFER_STATE_CONFLICT`，调用方应重新读取任务，而不是覆盖服务器状态。

## 到期边界

`expiresAt` 不为空时，时间达到或超过该值即视为到期；也就是说，`now === expiresAt` 已属于 `expired`。尚未进入终态的资源在读取时也会按此边界规范化为 `expired`，并在没有更具体原因时使用 `TRANSFER_EXPIRED`。

到期任务不得转回 `pending` 或 `running`。即使其失败原因标记为可重试，也应创建新的上传会话、下载意图或传输任务，不能复用旧任务标识。

已进入提交阶段的上传可能在一般到期边界后安全完成。服务只接受当前仍拥有提交权的执行结果；被取代的执行不会覆盖已确认状态，也不能借此开始新的上传操作。

## 失败与重试

`retryable` 由 `errorCode` 的类别计算，不由客户端设置。它表示相同操作在条件恢复后可能成功：

- `failed` 且 `retryable: true`：界面可以提供重试，并让服务决定从 `pending` 还是 `running` 继续。
- `failed` 且 `retryable: false`：应更改文件、格式或操作方式后重新发起。
- `expired`：始终创建新任务，不恢复原任务。
- `completed` 或 `canceled`：不提供重试。

错误码、可重试属性和处理建议见 [错误码参考](/reference/error-codes#传输与预览业务错误码)。

## 兼容旧状态

读取历史记录或旧版本响应时，ICEDR 会按下表归一化状态：

| 旧状态 | 规范状态 |
| --- | --- |
| `queued` | `pending` |
| `ready` | `completed` |
| `unsupported` | `failed` |
| `cancelled` | `canceled` |

无法识别的状态会按 `failed` 处理，避免误报为成功。为兼容旧客户端，部分响应暂时保留顶层时间字段；预览响应通过 `legacyPreviewStatus` 提供 `ready` / `unsupported` 等旧值，而主 `status` 与嵌套 `lifecycle.status` 均使用规范状态。新客户端应优先读取嵌套的 `lifecycle`，仅在连接旧服务且该对象不存在时回退到顶层字段。
