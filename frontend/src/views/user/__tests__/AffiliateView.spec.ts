import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import AffiliateView from '../AffiliateView.vue'

const getAffiliateDetail = vi.hoisted(() => vi.fn())
const transferAffiliateQuota = vi.hoisted(() => vi.fn())
const showError = vi.hoisted(() => vi.fn())
const showSuccess = vi.hoisted(() => vi.fn())
const refreshUser = vi.hoisted(() => vi.fn())
const copyToClipboard = vi.hoisted(() => vi.fn())

const messages: Record<string, string> = {
  'affiliate.stats.rebateRate': 'Rate',
  'affiliate.stats.rebateRateHint': 'Rate hint',
  'affiliate.stats.invitedUsers': 'Invited',
  'affiliate.stats.availableQuota': 'Available',
  'affiliate.stats.totalQuota': 'Total',
  'affiliate.title': 'Affiliate',
  'affiliate.description': 'Description',
  'affiliate.yourCode': 'Code',
  'affiliate.copyCode': 'Copy code',
  'affiliate.inviteLink': 'Invite link',
  'affiliate.copyLink': 'Copy link',
  'affiliate.tips.title': 'Tips',
  'affiliate.tips.line1': 'Line 1',
  'affiliate.tips.line2': 'Line 2 {rate}',
  'affiliate.tips.line3': 'Line 3',
  'affiliate.transfer.title': 'Transfer',
  'affiliate.transfer.description': 'Transfer description',
  'affiliate.transfer.button': 'Transfer',
  'affiliate.transfer.transferring': 'Transferring',
  'affiliate.transfer.empty': 'Empty',
  'affiliate.invitees.title': 'Invited Users',
  'affiliate.invitees.empty': 'No invitees',
  'affiliate.invitees.columns.email': 'Email',
  'affiliate.invitees.columns.username': 'Username',
  'affiliate.invitees.columns.rebate': 'Rebate',
  'affiliate.invitees.columns.todayUsage': 'Today',
  'affiliate.invitees.columns.weekUsage': 'This Week',
  'affiliate.invitees.columns.monthUsage': 'This Month',
  'affiliate.invitees.columns.joinedAt': 'Joined',
}

vi.mock('@/api/user', () => ({
  default: {
    getAffiliateDetail,
    transferAffiliateQuota,
  },
}))

vi.mock('@/stores/app', () => ({
  useAppStore: () => ({ showError, showSuccess }),
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ refreshUser }),
}))

vi.mock('@/composables/useClipboard', () => ({
  useClipboard: () => ({ copyToClipboard }),
}))

vi.mock('vue-i18n', async () => {
  const actual = await vi.importActual<typeof import('vue-i18n')>('vue-i18n')
  return {
    ...actual,
    useI18n: () => ({
      t: (key: string, params?: Record<string, string>) => {
        const message = messages[key] ?? key
        if (!params) return message
        return Object.entries(params).reduce((out, [name, value]) => out.replace(`{${name}}`, value), message)
      },
    }),
  }
})

function mountAffiliateView() {
  return mount(AffiliateView, {
    global: {
      stubs: {
        AppLayout: { template: '<div><slot /></div>' },
        Icon: true,
      },
    },
  })
}

describe('AffiliateView', () => {
  beforeEach(() => {
    getAffiliateDetail.mockReset()
    transferAffiliateQuota.mockReset()
    showError.mockReset()
    showSuccess.mockReset()
    refreshUser.mockReset()
    copyToClipboard.mockReset()

    getAffiliateDetail.mockResolvedValue({
      user_id: 1,
      aff_code: 'AFF1234',
      aff_count: 1,
      aff_quota: 0,
      aff_frozen_quota: 0,
      aff_history_quota: 0,
      effective_rebate_rate_percent: 20,
      invitees: [
        {
          user_id: 2,
          email: 'alic***@g***.com',
          username: 'alice',
          created_at: '2026-07-04T00:00:00Z',
          total_rebate: 1.25,
          usage: {
            today: { tokens: 1234, actual_cost: 0.12 },
            week: { tokens: 5678, actual_cost: 0.56 },
            month: { tokens: 9012, actual_cost: 0.9 },
          },
        },
      ],
    })
  })

  it('shows invitee usage windows', async () => {
    const wrapper = mountAffiliateView()
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain('alic***@g***.com')
    expect(text).toContain('Today')
    expect(text).toContain('This Week')
    expect(text).toContain('This Month')
    expect(text).toContain('1,234')
    expect(text).toContain('5,678')
    expect(text).toContain('9,012')
    expect(text).toContain('$0.12')
    expect(text).toContain('$0.56')
    expect(text).toContain('$0.90')
  })
})
