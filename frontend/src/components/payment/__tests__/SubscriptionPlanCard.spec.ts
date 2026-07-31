import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import SubscriptionPlanCard from '@/components/payment/SubscriptionPlanCard.vue'
import type { SubscriptionPlan } from '@/types/payment'
import type { UserSubscription } from '@/types'

vi.mock('vue-i18n', async importOriginal => {
  const actual = await importOriginal<typeof import('vue-i18n')>()

  return {
    ...actual,
    useI18n: () => ({
      t: (key: string) => ({
        'payment.subscribeNow': '立即开通',
        'payment.renewNow': '续费',
        'payment.days': '天',
        'payment.planCard.rate': '倍率',
        'payment.planCard.quota': '额度',
        'payment.planCard.unlimited': '不限',
        'payment.planCard.models': '模型',
      }[key] ?? key),
    }),
  }
})

const basePlan: SubscriptionPlan = {
  id: 7,
  group_id: 3,
  name: 'Starter',
  description: '',
  price: 128,
  original_price: 0,
  validity_days: 30,
  validity_unit: 'day',
  rate_multiplier: 1,
  daily_limit_usd: null,
  weekly_limit_usd: null,
  monthly_limit_usd: null,
  supported_model_scopes: ['claude', 'gemini_text', 'gemini_image'],
  features: [],
  group_platform: 'openai',
  sort_order: 1,
  for_sale: true,
  group_name: 'OpenAI',
}

// 挂载套餐卡片，便于分别验证按钮状态和平台模型范围展示。
function mountPlanCard(overrides: Partial<SubscriptionPlan> = {}, activeSubscriptions: UserSubscription[] = []) {
  const plan: SubscriptionPlan = { ...basePlan, ...overrides }

  return mount(SubscriptionPlanCard, {
    props: {
      plan,
      activeSubscriptions,
    },
    global: { plugins: [createPinia()] },
  })
}

describe('SubscriptionPlanCard action button', () => {
  it('keeps the subscribe button disabled and does not emit select', async () => {
    const wrapper = mountPlanCard()
    const button = wrapper.get('button')

    expect(button.text()).toBe('立即开通')
    expect(button.attributes('disabled')).toBeDefined()

    await button.trigger('click')

    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('keeps the renewal button disabled and does not emit select', async () => {
    const wrapper = mountPlanCard({}, [
      {
        id: 1,
        user_id: 2,
        group_id: basePlan.group_id,
        status: 'active',
        starts_at: '2026-01-01T00:00:00Z',
        daily_usage_usd: 0,
        weekly_usage_usd: 0,
        monthly_usage_usd: 0,
        daily_window_start: null,
        weekly_window_start: null,
        monthly_window_start: null,
        expires_at: '2099-01-01T00:00:00Z',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ])
    const button = wrapper.get('button')
    expect(button.text()).toBe('续费')
    expect(button.attributes('disabled')).toBeDefined()

    await button.trigger('click')

    expect(wrapper.emitted('select')).toBeUndefined()
  })
})

describe('SubscriptionPlanCard model scopes', () => {
  it('does not show Antigravity model scopes for OpenAI plans', () => {
    const text = mountPlanCard({ group_platform: 'openai' }).text()

    expect(text).not.toContain('Claude')
    expect(text).not.toContain('Gemini')
    expect(text).not.toContain('Imagen')
  })

  it('shows model scopes for Antigravity plans', () => {
    const text = mountPlanCard({ group_platform: 'antigravity' }).text()

    expect(text).toContain('Claude')
    expect(text).toContain('Gemini')
    expect(text).toContain('Imagen')
  })
})

describe('SubscriptionPlanCard currency', () => {
  it('uses the configured currency symbol while preserving USD for legacy plans', () => {
    const cnyPlan = mountPlanCard({ price: 10, currency: 'CNY', original_price: 20 }).text()

    expect(cnyPlan).toContain('¥10CNY')
    expect(cnyPlan).toContain('¥20CNY')
    expect(mountPlanCard({ price: 10, currency: 'USD' }).text()).toContain('$10USD')
    expect(mountPlanCard({ price: 10, currency: '' }).text()).toContain('$10')
  })
})

describe('SubscriptionPlanCard title layout', () => {
  it.each([
    ['long Chinese', '企业全球加速专业订阅套餐（含高级模型与优先支持）'],
    ['long English', 'Enterprise Global Acceleration Subscription with Priority Support'],
    ['unbroken token', 'EnterpriseGlobalAccelerationSubscriptionWithPrioritySupport1234567890'],
  ])('keeps the full %s plan title accessible in a bounded two-line area', (_label, name) => {
    const wrapper = mountPlanCard({ name })
    const title = wrapper.get('h3')

    expect(title.text()).toBe(name)
    expect(title.attributes('title')).toBe(name)
    expect(title.classes()).toEqual(expect.arrayContaining([
      'min-w-0',
      'h-12',
      'break-words',
      'line-clamp-2',
      '[overflow-wrap:anywhere]',
    ]))
    expect(title.classes()).not.toContain('truncate')
  })

  it('keeps title, badge, price, description, and purchase action in separate bounded regions', () => {
    const wrapper = mountPlanCard({
      name: 'Enterprise Global Acceleration Subscription with Priority Support',
      price: 123.45,
      currency: 'USD',
      description: 'Includes advanced models and priority support.',
    })
    const title = wrapper.get('h3')
    const badge = wrapper.findAll('span').find(node => node.text() === 'OpenAI')
    const price = wrapper.findAll('span').find(node => node.text() === '123.45')

    expect(title.element.parentElement?.classList).toContain('min-w-0')
    expect(title.element.parentElement?.classList).toContain('flex-1')
    expect(badge?.classes()).toContain('shrink-0')
    expect([...(badge?.element.parentElement?.classList ?? [])]).toEqual(expect.arrayContaining([
      'flex',
      'items-center',
      'justify-end',
    ]))
    expect(badge?.element.parentElement?.textContent).toContain('/ 30天')
    expect(badge?.element.parentElement?.parentElement?.classList).toContain('shrink-0')
    expect(price?.element.parentElement?.parentElement?.classList).toContain('shrink-0')
    expect(wrapper.get('p').text()).toBe('Includes advanced models and priority support.')
    expect(wrapper.get('button').text()).toBe('立即开通')
  })

  it('keeps short plan titles compact and aligned', () => {
    const wrapper = mountPlanCard({ name: 'Pro', description: '' })
    const title = wrapper.get('h3')
    const badge = wrapper.findAll('span').find(node => node.text() === 'OpenAI')

    expect(title.text()).toBe('Pro')
    expect(title.attributes('title')).toBe('Pro')
    expect(title.classes()).toEqual(expect.arrayContaining(['text-base', 'font-bold', 'h-12']))
    expect([...(badge?.element.parentElement?.classList ?? [])]).toEqual(expect.arrayContaining([
      'flex',
      'items-center',
      'justify-end',
    ]))
    expect(badge?.element.parentElement?.textContent).toContain('/ 30天')
  })
})
