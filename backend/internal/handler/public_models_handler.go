package handler

import (
	"context"
	"net/http"
	"sort"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/response"
	"github.com/Wei-Shaw/sub2api/internal/service"

	"github.com/gin-gonic/gin"
)

// ListPublicModels 处理 GET /api/v1/public/models 公开匿名接口（fork 扩展）。
//
// 该 method 故意挂在已有的 *AvailableChannelHandler 上，复用其私有字段
// channelService / settingService，避免新增 wire DI 注册（fork-friendly）。
// 对应路由在 router.go 中注册：
//
//	v1.Group("/public").GET("/models", h.AvailableChannel.ListPublicModels)
//
// 响应规则（按"分组"组织，pricing 返回渠道原始价，rate_multiplier 单独暴露给前端展示层）：
//  1. 顶层 data 直接是 array，每条是一个公开分组（IsExclusive=false）
//  2. 每个分组的 models = 所有 active 渠道里 group_ids 包含本分组 ID 且 platform 匹配的模型集合（按 model_id 去重）
//  3. pricing 价格 = 渠道原始价，单位仍是 积分/token 或 积分/次；前端展示时再乘 rate_multiplier
//  4. 价格字段 nil 或 0 时省略字段（json:omitempty）
//  5. price_status: 任一价格字段非 nil 非 0 → "priced"；全部 nil/0 → "unpriced"
//  6. pricing_mode: 取自渠道 BillingMode（"token" / "image" / "request"），fallback 为 "token"
//  7. 白名单 DTO，绝不出现 channel_id / upstream_url / api_key / account / restrict_models / billing_model_source 等运维字段
//  8. 响应头 Cache-Control: public, max-age=300
func (h *AvailableChannelHandler) ListPublicModels(c *gin.Context) {
	ctx := c.Request.Context()
	channels, err := h.channelService.ListAvailable(ctx)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}

	resolveID := h.modelIDResolver(ctx)
	groups := aggregatePublicModels(channels, resolveID)

	c.Header("Cache-Control", "public, max-age=300")
	response.Success(c, groups)
}

// ListProviderPricing 处理 GET /api/provider/pricing 公开价格抓取接口。
func (h *AvailableChannelHandler) ListProviderPricing(c *gin.Context) {
	ctx := c.Request.Context()
	channels, err := h.channelService.ListAvailable(ctx)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, providerPricingErrorResponse{
			SchemaVersion: providerPricingSchemaVersion,
			Success:       false,
			Message:       "service temporarily unavailable",
		})
		return
	}

	resolveID := h.modelIDResolver(ctx)
	c.Header("Cache-Control", "public, max-age=300")
	c.JSON(http.StatusOK, providerPricingSuccessResponse{
		SchemaVersion: providerPricingSchemaVersion,
		Success:       true,
		Data:          buildProviderPricing(channels, resolveID, time.Now()),
	})
}

const (
	providerPricingSchemaVersion = "1.0"
	providerPriceUnitMultiplier  = 1_000_000
	providerCreditPerCNY         = 6.5
)

// providerPricingSuccessResponse 是 hvoy 抓取协议的成功响应。
type providerPricingSuccessResponse struct {
	SchemaVersion string              `json:"schema_version"`
	Success       bool                `json:"success"`
	Message       string              `json:"message"`
	Data          providerPricingData `json:"data"`
}

// providerPricingErrorResponse 是 hvoy 抓取协议的失败响应。
type providerPricingErrorResponse struct {
	SchemaVersion string `json:"schema_version"`
	Success       bool   `json:"success"`
	Message       string `json:"message"`
}

// providerPricingData 承载本批公开价格数据和生成时间。
type providerPricingData struct {
	Currency   string                 `json:"currency"`
	PriceUnit  string                 `json:"price_unit"`
	SiteName   string                 `json:"site_name,omitempty"`
	SiteDomain string                 `json:"site_domain,omitempty"`
	UpdatedAt  string                 `json:"updated_at"`
	Models     []providerPricingModel `json:"models"`
}

// providerPricingModel 是一个 model + group 组合的公开价格条目。
type providerPricingModel struct {
	ModelName          string   `json:"model_name"`
	GroupName          string   `json:"group_name"`
	InputPrice         float64  `json:"input_price"`
	OutputPrice        *float64 `json:"output_price"`
	CacheInputPrice    *float64 `json:"cache_input_price"`
	CacheCreatePrice   *float64 `json:"cache_create_price"`
	CacheCreatePrice1H *float64 `json:"cache_create_price_1h"`
	Enabled            bool     `json:"enabled"`
	Note               string   `json:"note"`
}

// publicPricingDTO 模型定价子对象（嵌套在 publicModelDTO.Pricing 内）。
//
// 所有价格字段都是 *float64 + omitempty：上游 "0 = 未配置" 约定下，0 价格不应出现在响应里。
// 单位是 积分 per token（前端按需 ×1e6 转 积分/MTok 显示）。
type publicPricingDTO struct {
	PricingMode string `json:"pricing_mode"`
	PriceStatus string `json:"price_status"`

	InputPricePerToken       *float64             `json:"input_price_per_token,omitempty"`
	OutputPricePerToken      *float64             `json:"output_price_per_token,omitempty"`
	CacheWritePricePerToken  *float64             `json:"cache_write_price_per_token,omitempty"`
	CacheReadPricePerToken   *float64             `json:"cache_read_price_per_token,omitempty"`
	ImageOutputPricePerToken *float64             `json:"image_output_price_per_token,omitempty"`
	PerRequestPrice          *float64             `json:"per_request_price,omitempty"`
	PriceTiers               []publicPriceTierDTO `json:"price_tiers,omitempty"`
}

// publicPriceTierDTO 是公开模型广场可展示的按次价格档位。
type publicPriceTierDTO struct {
	TierLabel       string   `json:"tier_label"`
	PerRequestPrice *float64 `json:"per_request_price,omitempty"`
}

// publicModelDTO 公开接口模型条目。
type publicModelDTO struct {
	ID          string           `json:"id"`           // 模型最终调用 id（mapping 后），如 "gpt-5.2"
	DisplayName string           `json:"display_name"` // 用户友好名（mapping 前），如 "GPT-5.2"
	Pricing     publicPricingDTO `json:"pricing"`
}

// publicGroupDTO 公开接口分组条目。
//
// 注：上游 service.AvailableGroupRef 故意没有暴露 Description 字段，
// 此处遵循 fork-friendly 原则不扩展上游结构，description 固定为空字符串。
// 如需展示分组描述，可在前端用本地配置或后续 PR 上游补字段。
type publicGroupDTO struct {
	ID             int64            `json:"id"`
	Name           string           `json:"name"`
	Description    string           `json:"description"`
	Platform       string           `json:"platform"`
	RateMultiplier float64          `json:"rate_multiplier"`
	ModelCount     int              `json:"model_count"`
	Models         []publicModelDTO `json:"models"`
}

// priceStatusPriced / priceStatusUnpriced 用于 price_status 字段值。
const (
	priceStatusPriced   = "priced"
	priceStatusUnpriced = "unpriced"
)

// idResolver 把 (groupID, displayName) 解析为最终 mapped id。
// 由 handler 注入（实际实现走 ChannelService.ResolveChannelMapping）；测试用 stub。
type idResolver func(groupID int64, displayName string) string

// modelIDResolver 基于当前请求上下文解析渠道映射，无映射时回退到展示名。
func (h *AvailableChannelHandler) modelIDResolver(ctx context.Context) idResolver {
	return func(groupID int64, displayName string) string {
		res := h.channelService.ResolveChannelMapping(ctx, groupID, displayName)
		if res.MappedModel != "" {
			return res.MappedModel
		}
		return displayName
	}
}

// buildProviderPricing 将可用渠道视图转换为 hvoy 第三方价格协议数据。
func buildProviderPricing(channels []service.AvailableChannel, resolveID idResolver, now time.Time) providerPricingData {
	models := make([]providerPricingModel, 0)
	seen := make(map[string]struct{})

	for _, ch := range channels {
		if ch.Status != service.StatusActive {
			continue
		}
		for _, g := range ch.Groups {
			if g.IsExclusive {
				continue
			}
			rate := g.RateMultiplier
			if rate <= 0 {
				rate = 1.0
			}
			for _, m := range ch.SupportedModels {
				if m.Platform != g.Platform || m.Pricing == nil {
					continue
				}
				modelID := resolveID(g.ID, m.Name)
				key := g.Name + "\x00" + modelID
				if _, ok := seen[key]; ok {
					continue
				}
				seen[key] = struct{}{}

				models = append(models, providerPricingModel{
					ModelName:        modelID,
					GroupName:        g.Name,
					InputPrice:       providerPriceValue(m.Pricing.InputPrice, rate),
					OutputPrice:      providerOptionalPrice(m.Pricing.OutputPrice, rate),
					CacheInputPrice:  providerOptionalPrice(m.Pricing.CacheReadPrice, rate),
					CacheCreatePrice: providerOptionalPrice(m.Pricing.CacheWritePrice, rate),
					Enabled:          true,
				})
			}
		}
	}

	sort.SliceStable(models, func(i, j int) bool {
		if models[i].GroupName == models[j].GroupName {
			return models[i].ModelName < models[j].ModelName
		}
		return models[i].GroupName < models[j].GroupName
	})

	return providerPricingData{
		Currency:  "CNY",
		PriceUnit: "per_1m_tokens",
		UpdatedAt: now.UTC().Format(time.RFC3339),
		Models:    models,
	}
}

// providerPriceValue 把每 token 站内额度价换算为每 1M tokens 人民币价格；缺失时返回 0 以满足必填字段。
func providerPriceValue(base *float64, rate float64) float64 {
	if base == nil {
		return 0
	}
	return *base * rate * providerPriceUnitMultiplier / providerCreditPerCNY
}

// providerOptionalPrice 把可选价格换算为每 1M tokens 价格；缺失或 0 时返回 nil。
func providerOptionalPrice(base *float64, rate float64) *float64 {
	if base == nil || *base == 0 {
		return nil
	}
	v := providerPriceValue(base, rate)
	return &v
}

// aggregatePublicModels 将 service.AvailableChannel 列表聚合为公开模型广场响应（按公开分组组织）。
//
// 抽出为纯函数便于单元测试（不需要构造 ChannelService）。聚合规则见 ListPublicModels 注释。
func aggregatePublicModels(channels []service.AvailableChannel, resolveID idResolver) []publicGroupDTO {
	// modelKey 用于在同一分组内按 mapped model id 去重 —— 同一分组挂在多个渠道下可能拿到重名模型。
	type modelKey struct {
		groupID int64
		modelID string
	}

	groupMap := make(map[int64]*publicGroupDTO)
	groupSeen := make(map[modelKey]struct{})

	for _, ch := range channels {
		if ch.Status != service.StatusActive {
			continue
		}

		for _, g := range ch.Groups {
			if g.IsExclusive {
				continue
			}
			rate := g.RateMultiplier
			if rate <= 0 {
				rate = 1.0
			}

			for _, m := range ch.SupportedModels {
				if m.Platform != g.Platform {
					continue
				}
				if m.Pricing == nil {
					continue
				}

				modelID := resolveID(g.ID, m.Name)
				k := modelKey{groupID: g.ID, modelID: modelID}
				if _, ok := groupSeen[k]; ok {
					continue
				}
				groupSeen[k] = struct{}{}

				// 懒创建分组：仅在第一个有效模型时登记。
				gp, ok := groupMap[g.ID]
				if !ok {
					gp = &publicGroupDTO{
						ID:             g.ID,
						Name:           g.Name,
						Description:    "", // AvailableGroupRef 未暴露 Description，保持 fork-friendly 留空
						Platform:       g.Platform,
						RateMultiplier: rate,
						Models:         []publicModelDTO{},
					}
					groupMap[g.ID] = gp
				}

				gp.Models = append(gp.Models, publicModelDTO{
					ID:          modelID,
					DisplayName: m.Name,
					Pricing:     buildPricing(m.Pricing),
				})
			}
		}
	}

	// 每个分组内 model_count 在最后填充；分组按 ID 升序输出。
	groupIDs := make([]int64, 0, len(groupMap))
	for id := range groupMap {
		groupIDs = append(groupIDs, id)
	}
	sort.Slice(groupIDs, func(i, j int) bool { return groupIDs[i] < groupIDs[j] })

	out := make([]publicGroupDTO, 0, len(groupIDs))
	for _, id := range groupIDs {
		g := groupMap[id]
		// 分组内按 display name 排序确保稳定。
		sort.Slice(g.Models, func(i, j int) bool { return g.Models[i].DisplayName < g.Models[j].DisplayName })
		g.ModelCount = len(g.Models)
		out = append(out, *g)
	}
	return out
}

// buildPricing 把 service.ChannelModelPricing 转为 publicPricingDTO。
//
// 规则：
//   - PricingMode = BillingMode（空时 fallback "token"）
//   - 价格字段 nil 或 0 视为未配置，保持 nil（JSON omitempty 省略）
//   - 任一价格字段有值 → PriceStatus="priced"；全部无值 → "unpriced"
func buildPricing(p *service.ChannelModelPricing) publicPricingDTO {
	mode := string(p.BillingMode)
	if mode == "" {
		mode = string(service.BillingModeToken)
	}

	out := publicPricingDTO{
		PricingMode:              mode,
		InputPricePerToken:       copyOrSkip(p.InputPrice),
		OutputPricePerToken:      copyOrSkip(p.OutputPrice),
		CacheWritePricePerToken:  copyOrSkip(p.CacheWritePrice),
		CacheReadPricePerToken:   copyOrSkip(p.CacheReadPrice),
		ImageOutputPricePerToken: copyOrSkip(p.ImageOutputPrice),
		PerRequestPrice:          copyOrSkip(p.PerRequestPrice),
		PriceTiers:               buildPublicPriceTiers(p.Intervals),
	}

	hasAny := out.InputPricePerToken != nil ||
		out.OutputPricePerToken != nil ||
		out.CacheWritePricePerToken != nil ||
		out.CacheReadPricePerToken != nil ||
		out.ImageOutputPricePerToken != nil ||
		out.PerRequestPrice != nil ||
		len(out.PriceTiers) > 0
	if hasAny {
		out.PriceStatus = priceStatusPriced
	} else {
		out.PriceStatus = priceStatusUnpriced
	}
	return out
}

// copyOrSkip 返回 base 的拷贝；base 为 nil 或 0 时返回 nil（视为未配置）。
//
// 上游约定 "0 = 未配置"（参见 service.nonZeroPtr）；本函数把这一约定保留下来：
// 渠道里设 cache_write_price=0 表示未配置，JSON omitempty 会省略该字段。
func copyOrSkip(base *float64) *float64 {
	if base == nil || *base == 0 {
		return nil
	}
	v := *base
	return &v
}

// buildPublicPriceTiers 把内部 intervals 转为公开安全的按次价格档位。
func buildPublicPriceTiers(intervals []service.PricingInterval) []publicPriceTierDTO {
	if len(intervals) == 0 {
		return nil
	}

	sorted := append([]service.PricingInterval(nil), intervals...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].SortOrder < sorted[j].SortOrder })

	tiers := make([]publicPriceTierDTO, 0, len(sorted))
	for _, interval := range sorted {
		price := copyOrSkip(interval.PerRequestPrice)
		if price == nil {
			continue
		}
		tiers = append(tiers, publicPriceTierDTO{
			TierLabel:       interval.TierLabel,
			PerRequestPrice: price,
		})
	}
	return tiers
}
