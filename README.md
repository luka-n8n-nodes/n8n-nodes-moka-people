# @luka-cat-mimi/n8n-nodes-moka-people

Moka People（HCM 人事系统）的 n8n 社区节点，提供 Moka People 开放平台 API 的集成支持。

## 安装

参考：https://docs.n8n.io/integrations/community-nodes/installation/

节点名称：`@luka-cat-mimi/n8n-nodes-moka-people`

## 功能列表

### 人事接口 (8)

- 员工任职数据
- 待入职员工数据
- 新增员工
- 新增员工(支持批量附件)
- 更新员工
- 更新员工(支持批量附件)
- 通用附件上传
- 员工基本信息回写

## ✨ 特别之处

### 🔄 Return All 自动分页

以下接口支持 **Return All** 功能，自动处理分页获取全部数据：

| 模块     | 接口名称       |
| -------- | -------------- |
| 人事接口 | 员工任职数据   |
| 人事接口 | 待入职员工数据 |

### ⏱️ 超时与批次管理

大部分接口支持以下高级选项：

- **Timeout（超时时间）**：设置请求超时时间（毫秒），避免请求长时间挂起
- **Batching（批次管理）**：
  - **Items per Batch**：每批处理的数量，用于控制请求频率
  - **Batch Interval (ms)**：每批请求之间的等待时间，避免触发 API 限流

这些功能可在接口的 `Options` 选项中配置，有效应对 Moka People API 的频率限制。

## 凭证配置

凭证名称：**Moka People API** (`mokaPeopleApi`)

| 字段                      | 必填 | 说明                                                                                     |
| ------------------------- | ---- | ---------------------------------------------------------------------------------------- |
| API 基础地址 (baseUrl)    | 是   | 默认 `https://api.mokahr.com/api-platform/hcm/oapi`                                     |
| API Key (apiKey)          | 是   | 由 Moka People 提供，作为 Basic Auth 的 username 使用，password 为空                    |
| 企业租户 ID (entCode)     | 是   | 租户唯一 ID，由客户成功经理（CSM）提供                                                   |
| 默认接口编码 (apiCode)    | 否   | 在节点中可被覆盖；适合单 apiCode 场景一次性配置                                          |
| RSA 私钥 (privateKey)     | 是   | PKCS#8 编码的 RSA 私钥 Base64 字符串，裸 Base64 或完整 PEM 均可，签名工具会自动适配      |

## 鉴权机制说明

Moka People API 的鉴权由两部分组成：

1. **HTTP Header**：`Authorization: Basic Base64(apiKey:)`（冒号必须保留，password 为空）
2. **Query Params**：每个请求都需附带以下 5 个公共参数

| 参数        | 说明                                                 |
| ----------- | ---------------------------------------------------- |
| `entCode`   | 租户唯一 ID                                          |
| `apiCode`   | 当前接口对应的接口编码（在 Moka People 后台配置）    |
| `nonce`     | 随机字符串，长度不超过 8 位，5 分钟内不重复          |
| `timestamp` | 毫秒级时间戳（与服务器时间偏差不超过 3 分钟）        |
| `sign`      | 见下文签名算法                                       |

### 签名算法（md5WithRsa）

1. 将所有 Query Params **不含 `sign`** 按 key 字典序排序
2. 拼接为 `k1=v1&k2=v2&...` 格式（不做 url-encode）
3. 使用 RSA 私钥执行 `MD5withRSA` 签名
4. 对签名结果做 Base64 编码作为 `sign` 值

## 📝 许可证

MIT License

## 🆘 支持

- 📧 邮箱：luka.cat.mimi@gmail.com
- 🐛 [问题反馈](https://github.com/luka-n8n-nodes/n8n-nodes-moka-people/issues)
