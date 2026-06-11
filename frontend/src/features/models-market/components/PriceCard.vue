<template>
  <article class="price-card" :class="{ 'is-unpriced': isUnpriced }">
    <header class="card-head">
      <div class="head-text">
        <h3 class="model-name" :title="model.display_name">{{ model.display_name }}</h3>
        <p class="model-id" :title="model.id">{{ model.id }}</p>
      </div>
      <span class="billing-chip" :class="chipColor">{{ chipLabel }}</span>
    </header>

    <dl v-if="priceRows.length > 0" class="price-list">
      <div v-for="row in priceRows" :key="row.key" class="price-row">
        <dt>
          <span class="price-dot" :class="row.dotColor"></span>
          {{ row.label }}
        </dt>
        <dd>
          <span class="price-num">{{ row.num }}</span>
          <span class="price-unit">{{ row.unit }}</span>
        </dd>
      </div>
    </dl>
    <div v-else class="unpriced-hint">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10"></circle>
        <path d="M12 8v4M12 16h.01"></path>
      </svg>
      {{ t('card.unpriced') }}
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useModelsMarketText } from '../i18n'
import type { PublicModelEntry } from '../types'

interface PriceCardProps {
  model: PublicModelEntry
  rateMultiplier?: number
}

const props = withDefaults(defineProps<PriceCardProps>(), {
  rateMultiplier: 1,
})
const { t } = useModelsMarketText()

const PER_MILLION = 1_000_000

// 是否为未定价模型——决定卡片整体语义样式
const isUnpriced = computed(() => props.model.pricing.price_status === 'unpriced')

// chipLabel + chipColor 根据 pricing_mode + price_status 决定徽章文案与颜色
const chipLabel = computed(() => {
  const p = props.model.pricing
  if (p.price_status === 'unpriced') return t('card.unpriced')
  switch (p.pricing_mode) {
    case 'image':
      return t('card.imageBilling')
    case 'request':
      return t('card.requestBilling')
    case 'token':
    default:
      return t('card.tokenBilling')
  }
})

const chipColor = computed(() => {
  const p = props.model.pricing
  if (p.price_status === 'unpriced') return 'chip-gray'
  switch (p.pricing_mode) {
    case 'image':
      return 'chip-violet'
    case 'request':
      return 'chip-amber'
    case 'token':
    default:
      return 'chip-primary'
  }
})

// formatTokenPrice 把 per-token 基础价按分组倍率折算为 per-1M-token 并保留两位小数
function formatTokenPrice(perToken: number | undefined | null): string | null {
  if (perToken == null) return null
  return (perToken * props.rateMultiplier * PER_MILLION).toFixed(2)
}

// formatRequestPrice 把按次基础价按分组倍率折算后保留两位小数。
function formatRequestPrice(price: number | undefined | null): string | null {
  if (price == null) return null
  return (price * props.rateMultiplier).toFixed(2)
}

// Row 比原来多带一个 dotColor，用小色点替代纯文字标签让 i/o/cache 一眼可辨
interface Row {
  key: string
  label: string
  num: string
  unit: string
  dotColor: string
}

type LabelKey =
  | 'price.input'
  | 'price.output'
  | 'price.cacheRead'
  | 'price.cacheWrite'
  | 'price.image'

const dotColorMap: Record<LabelKey, string> = {
  'price.input': 'dot-blue',
  'price.output': 'dot-emerald',
  'price.cacheRead': 'dot-cyan',
  'price.cacheWrite': 'dot-amber',
  'price.image': 'dot-violet',
}

const priceRows = computed<Row[]>(() => {
  const rows: Row[] = []
  const p = props.model.pricing
  const tokenUnit = t('price.unitToken')
  const reqUnit = t('price.unitRequest')

  // 图片计费存在 tiers 时优先展示按次档位，避免误落入 token 单位。
  if (p.pricing_mode === 'image' && p.price_tiers?.length) {
    for (const tier of p.price_tiers) {
      const num = formatRequestPrice(tier.per_request_price)
      if (num == null) continue
      rows.push({
        key: `tier-${tier.tier_label}`,
        label: tier.tier_label,
        num,
        unit: reqUnit,
        dotColor: 'dot-violet',
      })
    }
    return rows
  }

  // per_request 模式：只显示按次价格，隐藏 token 行
  const isPerRequest = p.pricing_mode === 'request' || p.per_request_price != null
  if (isPerRequest) {
    const num = formatRequestPrice(p.per_request_price)
    if (num != null) {
      rows.push({
        key: 'perRequest',
        label: t('price.perRequest'),
        num,
        unit: reqUnit,
        dotColor: 'dot-amber',
      })
    }
    return rows
  }

  // pushPriceRow 仅在字段有价格时追加对应价格行。
  function pushPriceRow(key: string, labelKey: LabelKey, perToken: number | undefined): void {
    const v = formatTokenPrice(perToken)
    if (v == null) return

    rows.push({
      key,
      label: t(labelKey),
      num: v,
      unit: tokenUnit,
      dotColor: dotColorMap[labelKey],
    })
  }

  pushPriceRow('input', 'price.input', p.input_price_per_token)
  pushPriceRow('output', 'price.output', p.output_price_per_token)
  pushPriceRow('cacheRead', 'price.cacheRead', p.cache_read_price_per_token)
  pushPriceRow('cacheWrite', 'price.cacheWrite', p.cache_write_price_per_token)
  pushPriceRow('image', 'price.image', p.image_output_price_per_token)

  return rows
})
</script>

<style scoped>
/* —— 卡片本体 —— */
.price-card {
  @apply relative flex flex-col rounded-2xl border border-gray-200/70 bg-white p-4 transition-all;
  @apply dark:border-dark-700/60 dark:bg-dark-800;
}
.price-card:hover {
  @apply -translate-y-0.5 border-primary-200 shadow-card-hover;
  @apply dark:border-primary-700/60;
}
.price-card.is-unpriced { @apply bg-gray-50/60 dark:bg-dark-900/40; }

/* —— 头部 —— */
.card-head { @apply flex items-start justify-between gap-3; }
.head-text { @apply min-w-0 flex-1; }
.model-name { @apply truncate text-base font-semibold leading-tight text-gray-900 dark:text-white; }
.model-id {
  @apply mt-1 truncate font-mono text-[11px] text-gray-500 dark:text-dark-400;
}

/* —— 计费类型 chip：根据 chipColor 切换 —— */
.billing-chip {
  @apply flex-none rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide;
}
.chip-primary {
  @apply bg-primary-50 text-primary-700 ring-1 ring-primary-100;
  @apply dark:bg-primary-900/30 dark:text-primary-300 dark:ring-primary-800/40;
}
.chip-violet {
  @apply bg-violet-50 text-violet-700 ring-1 ring-violet-100;
  @apply dark:bg-violet-900/30 dark:text-violet-300 dark:ring-violet-800/40;
}
.chip-amber {
  @apply bg-amber-50 text-amber-700 ring-1 ring-amber-100;
  @apply dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-800/40;
}
.chip-gray {
  @apply bg-gray-100 text-gray-600 ring-1 ring-gray-200;
  @apply dark:bg-dark-700/60 dark:text-dark-300 dark:ring-dark-600/40;
}

/* —— 价格列表：用细分隔线串起，比纯灰底块更清晰 —— */
.price-list {
  @apply mt-3.5 divide-y divide-gray-100 border-t border-gray-100;
  @apply dark:divide-dark-700/60 dark:border-dark-700/60;
}
.price-row {
  @apply flex items-center justify-between py-2.5 text-sm;
}
.price-row dt {
  @apply flex items-center gap-2 text-gray-500 dark:text-dark-400;
}
.price-row dd {
  @apply flex items-baseline gap-1.5;
}

/* —— 价格点 —— */
.price-dot {
  @apply inline-block h-1.5 w-1.5 rounded-full;
}
.dot-blue { @apply bg-blue-400 dark:bg-blue-500; }
.dot-emerald { @apply bg-emerald-400 dark:bg-emerald-500; }
.dot-cyan { @apply bg-cyan-400 dark:bg-cyan-500; }
.dot-amber { @apply bg-amber-400 dark:bg-amber-500; }
.dot-violet { @apply bg-violet-400 dark:bg-violet-500; }

/* —— 数值 + 单位 —— */
.price-num { @apply font-mono text-[15px] font-semibold tabular-nums text-gray-900 dark:text-white; }
.price-unit { @apply text-[10px] uppercase tracking-wide text-gray-400 dark:text-dark-500; }

/* —— 未定价提示 —— */
.unpriced-hint {
  @apply mt-3.5 flex items-center justify-center gap-2 rounded-xl py-3 text-sm;
  @apply bg-gray-50 text-gray-500 dark:bg-dark-900/40 dark:text-dark-400;
}
.unpriced-hint svg { @apply h-4 w-4; }
</style>
