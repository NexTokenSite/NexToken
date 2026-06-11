import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import PriceCard from '../components/PriceCard.vue'
import type { PublicModelEntry } from '../types'

const i18n = createI18n({ legacy: false, locale: 'zh', messages: { zh: {}, en: {} } })

const baseModel: PublicModelEntry = {
  id: 'gpt-5.2',
  display_name: 'GPT-5.2',
  pricing: {
    pricing_mode: 'token',
    price_status: 'priced',
    input_price_per_token: 0.00000175,
    output_price_per_token: 0.000014,
    cache_read_price_per_token: 1.75e-7,
  },
}

describe('PriceCard', () => {
  it('显示 display_name 与 id 副标题', () => {
    const w = mount(PriceCard, { props: { model: baseModel }, global: { plugins: [i18n] } })
    expect(w.text()).toContain('GPT-5.2')
    expect(w.text()).toContain('gpt-5.2')
  })

  it('价格按 per-token × 分组倍率 × 1M 转为积分/MTok 并保留两位小数', () => {
    const w = mount(PriceCard, {
      props: { model: baseModel, rateMultiplier: 1.3 },
      global: { plugins: [i18n] },
    })
    const text = w.text()
    expect(text).toContain('2.28')   // input: 0.00000175 × 1.3 × 1e6 = 2.275
    expect(text).toContain('18.20')  // output: 0.000014 × 1.3 × 1e6 = 18.2
    expect(text).toContain('0.23')   // cache read: 1.75e-7 × 1.3 × 1e6 = 0.2275
    expect(text).toContain('积分 / 1M Token')
  })

  it('cache_write 字段缺失时不展示该行', () => {
    const w = mount(PriceCard, { props: { model: baseModel }, global: { plugins: [i18n] } })
    expect(w.text()).not.toContain('缓存写入')
  })

  it('price_status=unpriced 显示"暂无定价"', () => {
    const m: PublicModelEntry = {
      id: 'm',
      display_name: 'M',
      pricing: { pricing_mode: 'token', price_status: 'unpriced' },
    }
    const w = mount(PriceCard, { props: { model: m }, global: { plugins: [i18n] } })
    expect(w.text()).toContain('暂无定价')
    // 不应有任何 token 行
    expect(w.text()).not.toContain('输入')
    expect(w.text()).not.toContain('输出')
  })

  it('pricing_mode=request 隐藏 token 行，按次价格按分组倍率展示', () => {
    const m: PublicModelEntry = {
      id: 'm',
      display_name: 'M',
      pricing: {
        pricing_mode: 'request',
        price_status: 'priced',
        per_request_price: 0.05,
        // 即使有 token 字段也应被忽略
        input_price_per_token: 0.0000025,
      },
    }
    const w = mount(PriceCard, {
      props: { model: m, rateMultiplier: 10 },
      global: { plugins: [i18n] },
    })
    expect(w.text()).not.toContain('输入')
    expect(w.text()).toContain('按次')
    expect(w.text()).toContain('0.50')
    expect(w.text()).toContain('积分 / 次')
  })

  it('chip 文案随 pricing_mode 切换', () => {
    const tokenW = mount(PriceCard, { props: { model: baseModel }, global: { plugins: [i18n] } })
    expect(tokenW.text()).toContain('Token 计费')

    const imageW = mount(PriceCard, {
      props: {
        model: {
          ...baseModel,
          pricing: { pricing_mode: 'image', price_status: 'priced', image_output_price_per_token: 0.000032 },
        },
      },
      global: { plugins: [i18n] },
    })
    expect(imageW.text()).toContain('图片计费')

    const reqW = mount(PriceCard, {
      props: {
        model: {
          ...baseModel,
          pricing: { pricing_mode: 'request', price_status: 'priced', per_request_price: 0.01 },
        },
      },
      global: { plugins: [i18n] },
    })
    expect(reqW.text()).toContain('按次计费')
  })

  it('pricing_mode=image 且存在 price_tiers 时按图片档位展示按次价格', () => {
    const m: PublicModelEntry = {
      id: 'gpt-image-2',
      display_name: 'GPT-Image-2',
      pricing: {
        pricing_mode: 'image',
        price_status: 'priced',
        input_price_per_token: 0.000005,
        image_output_price_per_token: 0.000032,
        price_tiers: [
          { tier_label: '1K', per_request_price: 1 },
          { tier_label: '2K', per_request_price: 1.5 },
          { tier_label: '4K', per_request_price: 2 },
        ],
      },
    }
    const w = mount(PriceCard, { props: { model: m, rateMultiplier: 1.3 }, global: { plugins: [i18n] } })
    const text = w.text()
    expect(text).toContain('1K')
    expect(text).toContain('1.30')
    expect(text).toContain('2K')
    expect(text).toContain('1.95')
    expect(text).toContain('4K')
    expect(text).toContain('2.60')
    expect(text).toContain('积分 / 次')
    expect(text).not.toContain('积分 / 1M Token')
    expect(text).not.toContain('输入')
  })

  it('image_output 单独存在时显示图像输出行', () => {
    const m: PublicModelEntry = {
      id: 'gpt-image-2',
      display_name: 'GPT-Image-2',
      pricing: {
        pricing_mode: 'token', // 注意：本项目里图片输出仍可能挂在 token 模式下
        price_status: 'priced',
        input_price_per_token: 0.000005,
        image_output_price_per_token: 0.000032, // ×1e6 = 32
      },
    }
    const w = mount(PriceCard, { props: { model: m }, global: { plugins: [i18n] } })
    expect(w.text()).toContain('图像输出')
    expect(w.text()).toContain('32.00')
  })
})
