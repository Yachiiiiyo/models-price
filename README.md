# xLyra 模型标准目录

`catalog.json` 是 xLyra 使用的模型标准目录，按厂商 brand 分区，由维护者统一维护。

## 版本字段

- `schema_version`：目录结构版本，发生不兼容结构变化时递增。
- `catalog_version`：模型、协议、能力或价格内容版本，按语义版本递增。
- `updated_at`：本次内容修改时间，使用 UTC 的 ISO 8601 格式。

内容修正递增 patch，例如 `1.0.1`；新增兼容内容递增 minor；结构不兼容变化递增 major，并同步提升 `schema_version`。

## 文件结构

```text
catalog.json          模型、能力、协议、限制和价格
catalog.schema.json   JSON Schema
```

模型对象沿用 xLyra 当前字段：

- `model_key`、`display_name`、`provider`、`category`
- `capabilities`、`supported_endpoint_types`、`modalities`
- `context_window`、`max_output_tokens`
- `input_price`、`output_price`
- `cache_read_ratio`、`cache_write_ratio`、`cache_write_1h_ratio`
- `pricing_variants`
- `aliases`、`status`、`pricing_source`

`modalities`、`capabilities` 未知时写 `{}`，不要写 `[]` 或猜测的 `false`：xLyra 会用目录里的能力键覆盖上游报告的值。

## 协议规则

`supported_endpoint_types` 表示模型可使用的接口协议。

- `openai`：OpenAI Chat Completions 协议
- `openai-response`：OpenAI Responses 协议
- `anthropic-messages`：Anthropic Messages 协议
- `google-gemini`：Gemini 原生协议
- `openai-image`：OpenAI 图片生成协议
- `openai-embedding`：OpenAI Embeddings 协议
- `systemone`：TypeSafe System One 协议（`POST /v1/systemone`，请求体为 `model` + `state` + `questions`，不是 `messages`）

协议必须按模型实际能力填写，不能仅根据品牌或模型类别推断。模型支持多个协议时，按稳定性和完整性列出全部可用协议。

目录表达模型的默认能力；具体站点的协议限制属于 xLyra 运行时配置。

## 价格规则

基础 token 价格使用每 1M token 的金额，与 xLyra 的 `input_price` / `output_price` 一致。缓存比例由缓存价格除以普通输入价格得到。长上下文、fast、峰谷和缓存时长等无法由基础字段表达的价格放在 `pricing_variants` 中。

xLyra 计费不读 `pricing_variants`，只读下面两处，新增或修改长上下文、fast/priority 价格时必须两边同步：

- 长上下文：`cost.tiers`。只取第一个 `type: context` 的档位，按它相对 `cost.input` / `cost.output` 的倍率计费，所以档位按阈值升序排列。
- fast/priority：`experimental.modes.fast.cost`。上游响应的 `service_tier` 为 fast 或 priority 时使用。

模型下线时将 `status` 改为 `archived`，不要删除历史模型。模型别名写入 `aliases`，规范键写入 `model_key`。别名不能等于其他模型的 `model_key`（xLyra 先按 key 匹配，这样的别名永远不会生效），同一个别名只能属于一个模型。

修改后先使用 `catalog.schema.json` 校验 JSON，再检查协议、价格、上下文限制和别名是否完整。

## 浏览页面

GitHub Pages 静态浏览页：<https://yachiiiiyo.github.io/models-price/>

本地预览：在仓库根目录运行 `python3 -m http.server`，然后打开 <http://localhost:8000>（直接双击 html 会被浏览器拦截 fetch）。
