# 上传门禁防御加固（06082e1增量）

- 429明确返回 `Connection: close`；仍保留 `Retry-After: 1` 与响应体。使用Node HTTP正常响应关闭机制，不在响应写出前强制销毁socket。
- parser完成回调增加独立一次性guard。重复next、同步parser抛错后进入同一回调不再重复启动业务。未改变2活跃、120秒上传deadline或handler finally生命周期。

## 红绿证据
新增 `tests/unit/uploadAdmissionDefence.test.ts`：
1. 异常parser连续next两次，旧实现handler调用2次（期望1次）失败；新实现仅调用1次，响应结束后仍等handler settle释放permit；下一请求占用时再超额仍429，验证不重复释放。
2. 本机独立随机端口真实HTTP发送声明1000000字节但不结束的合成multipart body。先以独立占用请求填满1并发测试gate，拒绝请求不得进入parser。测试把server.keepAliveTimeout设为60秒以排除恰逢空闲超时：旧实现1500ms内未close；新实现完整收到429/Retry-After/Connection: close后及时close。此结果是拒绝连接及时关闭契约，不证明旧版本无限保持或无限资源漏洞。finally销毁测试socket、结束占用请求并关闭临时server。

定向3文件12/12通过（新增2、既有gate7、真实集成3）；TypeScript全检查与变更ESLint通过。没有全仓、浏览器、真实外部API或生产服务操作。64MiB仍指累计文件payload，不是RSS或所有HTTP字节上限。
