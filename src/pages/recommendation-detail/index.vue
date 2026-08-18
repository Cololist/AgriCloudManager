<template>
  <view class="page">
    <scroll-view class="page-scroll" scroll-y>
      <view v-if="!recommendation" class="empty-wrap">
        <text class="empty-text">未找到推荐详情</text>
        <button class="back-market" @click="goMarket">返回行情</button>
      </view>

      <view v-else>
        <!-- 方案头部 -->
        <view class="header">
          <button class="back-link" @click="goMarket">
            <SvgIcon name="arrow-left" :size="16" color="var(--acm-white)" />
            <text>返回</text>
          </button>
          <view class="header-content">
            <view class="header-tags">
              <text class="header-tag">{{ recommendation.tag }}</text>
              <text class="header-match">匹配度 {{ recommendation.matchScore }}%</text>
            </view>
            <text class="header-title">{{ recommendation.content }}</text>
            <text class="header-subtitle">{{ recommendation.title }}</text>
          </view>
          <view class="header-roi">
            <text class="roi-label">未来7日变化</text>
            <text class="roi-value">{{ formatSignedRate(recommendation.roi) }}</text>
          </view>
        </view>

        <view class="content">
          <!-- 匹配度卡片 -->
          <view class="match-card">
            <view class="match-head">
              <view>
                <text class="match-title">数据匹配度</text>
                <text class="match-tag">{{ recommendation.tag }}</text>
              </view>
              <text class="match-score">{{ recommendation.matchScore }}%</text>
            </view>
            <view class="match-reason">
              <SvgIcon name="lightbulb" :size="15" color="var(--acm-warning-deep)" />
              <text>{{ recommendation.reason }}</text>
            </view>
          </view>

          <!-- 行情依据 -->
          <view class="card">
            <view class="card-title-row">
              <SvgIcon name="trending-up" :size="18" color="var(--acm-primary)" />
              <text class="card-title">行情依据</text>
            </view>
            <view class="income-grid">
              <view class="income-item income-item-main">
                <text class="income-label">当前参考货值</text>
                <text class="income-value">{{ recommendation.profit > 0 ? `¥${recommendation.profit.toLocaleString('zh-CN')}` : '待补充产量' }}</text>
              </view>
              <view class="income-item income-item-main">
                <text class="income-label">未来7日变化</text>
                <text class="income-value">{{ formatSignedRate(recommendation.roi) }}</text>
              </view>
              <view class="income-item">
                <text class="income-label">预测周期</text>
                <text class="income-value-normal">{{ recommendation.cycle }}</text>
              </view>
            </view>
            <view class="income-detail">
              <view class="detail-row">
                <SvgIcon name="calendar" :size="14" color="var(--acm-text-muted)" />
                <text>实施周期：{{ recommendation.cycle }}</text>
              </view>
              <view class="detail-row">
                <SvgIcon name="gauge" :size="14" color="var(--acm-text-muted)" />
                <text>实施难度：{{ recommendation.difficulty }}</text>
              </view>
            </view>
          </view>

          <!-- 核心优势 -->
          <view class="card">
            <view class="card-title-row">
              <SvgIcon name="sparkles" :size="18" color="var(--acm-primary)" />
              <text class="card-title">数据要点</text>
            </view>
            <view class="benefit-list">
              <view v-for="(benefit, index) in recommendation.benefits" :key="index" class="benefit-item">
                <text class="benefit-index">{{ index + 1 }}</text>
                <text class="benefit-text">{{ benefit }}</text>
              </view>
            </view>
          </view>

          <!-- 实施步骤 -->
          <view class="card">
            <view class="card-title-row">
              <SvgIcon name="list-checks" :size="18" color="var(--acm-primary)" />
              <text class="card-title">实施步骤</text>
            </view>
            <view class="step-list">
              <view v-for="(step, index) in implementationSteps" :key="index" class="step-item">
                <view class="step-left">
                  <text class="step-index">{{ index + 1 }}</text>
                </view>
                <view class="step-main">
                  <text class="step-title">{{ step.title }}</text>
                  <text class="step-desc">{{ step.description }}</text>
                </view>
              </view>
            </view>
          </view>

          <!-- 风险提示 -->
          <view class="warn-card">
            <view class="warn-title">
              <SvgIcon name="alert-triangle" :size="16" color="var(--acm-warning-deep)" />
              <text>风险提示</text>
            </view>
            <view class="warn-list">
              <view class="warn-item">
                <SvgIcon name="alert-circle" :size="14" color="var(--acm-warning)" />
                <text>预测结果用于辅助判断，实际成交以询价为准</text>
              </view>
              <view class="warn-item">
                <SvgIcon name="alert-circle" :size="14" color="var(--acm-warning)" />
                <text>品级、规格和产地差异会影响实际价格</text>
              </view>
              <view class="warn-item">
                <SvgIcon name="alert-circle" :size="14" color="var(--acm-warning)" />
                <text>比较报价时应同时核算运输和装卸成本</text>
              </view>
              <view class="warn-item">
                <SvgIcon name="alert-circle" :size="14" color="var(--acm-warning)" />
                <text>建议分批成交，降低短期价格波动影响</text>
              </view>
            </view>
          </view>

          <!-- 操作按钮 -->
          <view class="action-buttons">
            <button class="action-btn action-btn-primary" @click="adoptPlan">
              <SvgIcon name="check" :size="18" color="var(--acm-white)" />
              <text>采用建议</text>
            </button>
            <button :class="['action-btn', isFavorited ? 'action-btn-favorited' : 'action-btn-secondary']" @click="toggleFavorite">
              <SvgIcon :name="isFavorited ? 'heart' : 'heart'" :size="18" :color="isFavorited ? 'var(--acm-danger)' : 'var(--acm-text-secondary)'" />
              <text>{{ isFavorited ? '已收藏' : '收藏方案' }}</text>
            </button>
            <button class="action-btn action-btn-secondary" @click="sharePlan">
              <SvgIcon name="share-2" :size="18" color="var(--acm-text-secondary)" />
              <text>分享方案</text>
            </button>
          </view>

          <view class="bottom-text">经营推荐 · 基于实际数据分析</view>
          <view class="nav-gap"></view>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import SvgIcon from '../../components/SvgIcon.vue'

interface RecommendationData {
  title: string
  content: string
  roi: string
  profit: number
  benefits: string[]
  tag: string
  difficulty: string
  cycle: string
  matchScore: number
  reason: string
}

interface StepData {
  title: string
  description: string
}

const recommendation = ref<RecommendationData | null>(null)
const isFavorited = ref(false)

onLoad((options) => {
  const payload = options?.data
  if (!payload || typeof payload !== 'string') {
    recommendation.value = null
    return
  }

  try {
    const parsed = JSON.parse(decodeURIComponent(payload)) as RecommendationData
    recommendation.value = parsed
  } catch (error) {
    recommendation.value = null
  }
})

const formatSignedRate = (value: string | number) => {
  if (String(value || '').trim() === '--') return '--'
  const rate = Number(value || 0)
  if (!Number.isFinite(rate)) return '0.0%'
  return `${rate > 0 ? '+' : ''}${rate.toFixed(1)}%`
}

const implementationSteps = computed<StepData[]>(() => {
  if (!recommendation.value) return []
  return [
    { title: '核对可售数量', description: '确认库存、品级、规格和预计上市时间' },
    { title: '联系匹配市场', description: '优先联系已匹配市场，确认起收量和结算方式' },
    { title: '比较到手价格', description: '将运输、装卸等费用纳入报价比较' },
    { title: '分批安排成交', description: '结合七日趋势分批询价并记录实际成交结果' },
  ]
})

const goMarket = () => {
  uni.redirectTo({
    url: '/pages/market/index',
    fail: () => {
      uni.reLaunch({ url: '/pages/market/index' })
    },
  })
}

const adoptPlan = () => {
  uni.showModal({
    title: '采用建议',
    content: '确定采用这条销售建议吗？后续可按步骤安排询价和成交。',
    confirmText: '确定采用',
    cancelText: '再想想',
    confirmColor: '#367d49',
    success: (res) => {
      if (res.confirm) {
        uni.showToast({ title: '建议已采用', icon: 'success' })
      }
    },
  })
}

const toggleFavorite = () => {
  isFavorited.value = !isFavorited.value
  uni.showToast({
    title: isFavorited.value ? '已收藏' : '已取消收藏',
    icon: 'none',
  })
}

const sharePlan = () => {
  // #ifdef H5
  if (navigator.share) {
    navigator.share({
      title: recommendation.value?.content || '农业推荐方案',
      text: `${recommendation.value?.content} - 未来7日变化${formatSignedRate(recommendation.value?.roi || 0)}`,
    }).catch(() => {})
  } else {
    uni.showToast({ title: '已复制分享链接', icon: 'success' })
  }
  // #endif

  // #ifndef H5
  uni.setClipboardData({
    data: `${recommendation.value?.content || '农业推荐方案'}\n未来7日变化：${formatSignedRate(recommendation.value?.roi || 0)}`,
    success: () => uni.showToast({ title: '方案摘要已复制', icon: 'success' }),
  })
  // #endif
}
</script>

<style scoped lang="scss">
.page {
  height: 100%;
  background: var(--acm-bg-page);
}

.page-scroll {
  height: 100%;
}

.empty-wrap {
  height: 100%;
  padding: 120rpx 32rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24rpx;
}

.empty-text {
  font-size: 30rpx;
  color: var(--acm-text-muted);
}

.back-market {
  border: 0;
  border-radius: 16rpx;
  background: var(--acm-primary);
  color: var(--acm-white);
  font-size: 30rpx;
  padding: 18rpx 36rpx;
}

.header {
  background: linear-gradient(135deg, var(--acm-primary), var(--acm-primary-light));
  padding: 96rpx 32rpx 40rpx;
  position: relative;
}

.back-link {
  border: 0;
  background: transparent;
  color: var(--acm-white);
  font-size: 28rpx;
  margin-bottom: 24rpx;
  padding: 0;
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.header-content {
  margin-bottom: 24rpx;
}

.header-tags {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-bottom: 16rpx;
}

.header-tag {
  background: var(--acm-white-90);
  color: var(--acm-primary);
  border-radius: 8rpx;
  font-size: 22rpx;
  padding: 8rpx 20rpx;
}

.header-match {
  color: var(--acm-white-80);
  font-size: 22rpx;
}

.header-title {
  display: block;
  font-size: 44rpx;
  color: var(--acm-white);
  margin-bottom: 8rpx;
  font-weight: 600;
}

.header-subtitle {
  display: block;
  font-size: 26rpx;
  color: var(--acm-white-82);
}

.header-roi {
  background: var(--acm-white-90);
  border-radius: 24rpx;
  padding: 24rpx 32rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.roi-label {
  font-size: 26rpx;
  color: var(--acm-text-secondary);
}

.roi-value {
  font-size: 48rpx;
  color: var(--acm-danger);
  font-weight: 600;
}

.content {
  padding: 24rpx 24rpx 0;
}

.match-card {
  border-radius: 32rpx;
  border: 2rpx solid var(--acm-border-warning);
  background: linear-gradient(135deg, var(--acm-bg-warning-soft), var(--acm-bg-warning-soft-2));
  padding: 32rpx;
  margin-bottom: 20rpx;
  overflow: hidden;
}

.match-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24rpx;
}

.match-title {
  display: block;
  font-size: 32rpx;
  color: var(--acm-warning-deep);
  margin-bottom: 4rpx;
}

.match-tag {
  display: block;
  font-size: 22rpx;
  color: var(--acm-warning-muted);
}

.match-score {
  font-size: 72rpx;
  color: var(--acm-warning);
  font-weight: 600;
}

.match-reason {
  display: flex;
  align-items: flex-start;
  gap: 8rpx;
  font-size: 26rpx;
  color: var(--acm-warning-deep);
  line-height: 1.5;
  background: var(--acm-white-60);
  border-radius: 16rpx;
  padding: 24rpx;
}

.card-title-row {
  display: flex;
  align-items: center;
  gap: 10rpx;
  margin-bottom: 32rpx;
}

.card {
  background: var(--acm-white);
  border-radius: 32rpx;
  padding: 32rpx;
  margin-bottom: 20rpx;
  box-shadow: var(--acm-shadow-sm);
  overflow: hidden;
}

.card-title {
  font-size: 34rpx;
  color: var(--acm-text-primary);
  font-weight: 600;
}

.income-grid {
  display: flex;
  gap: 24rpx;
  margin-bottom: 24rpx;
}

.income-item {
  width: calc((100% - 48rpx) / 3);
  border-radius: 24rpx;
  background: var(--acm-bg-soft);
  padding: 24rpx;
  text-align: center;
  box-sizing: border-box;
}

.income-item-main {
  background: var(--acm-bg-success-soft);
}

.income-label {
  display: block;
  font-size: 22rpx;
  color: var(--acm-text-muted);
  margin-bottom: 16rpx;
}

.income-value {
  display: block;
  font-size: 40rpx;
  color: var(--acm-primary);
  font-weight: 600;
}

.income-value-normal {
  display: block;
  font-size: 32rpx;
  color: var(--acm-text-secondary);
}

.income-detail {
  background: var(--acm-bg-panel-alt);
  border-radius: 24rpx;
  padding: 20rpx 24rpx;
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.detail-row {
  display: flex;
  align-items: center;
  gap: 8rpx;
  font-size: 26rpx;
  color: var(--acm-text-secondary);
}

.benefit-list {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}

.benefit-item {
  border-radius: 24rpx;
  background: var(--acm-bg-soft);
  padding: 24rpx;
  display: flex;
  align-items: flex-start;
  gap: 24rpx;
}

.benefit-index {
  width: 48rpx;
  height: 48rpx;
  border-radius: 9999rpx;
  background: var(--acm-primary);
  color: var(--acm-white);
  font-size: 24rpx;
  line-height: 48rpx;
  text-align: center;
  margin-top: 2rpx;
  flex-shrink: 0;
}

.benefit-text {
  flex: 1;
  font-size: 28rpx;
  color: var(--acm-text-secondary);
  line-height: 1.625;
}

.step-list {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.step-item {
  display: flex;
  align-items: flex-start;
  gap: 16rpx;
}

.step-left {
  flex-shrink: 0;
}

.step-index {
  width: 64rpx;
  height: 64rpx;
  border-radius: 16rpx;
  background: var(--acm-bg-success-soft);
  color: var(--acm-primary);
  font-size: 28rpx;
  font-weight: 600;
  line-height: 64rpx;
  text-align: center;
  display: block;
}

.step-main {
  flex: 1;
  background: var(--acm-bg-soft);
  border-radius: 20rpx;
  padding: 20rpx 24rpx;
}

.step-title {
  display: block;
  font-size: 30rpx;
  color: var(--acm-text-primary);
  margin-bottom: 6rpx;
  font-weight: 600;
}

.step-desc {
  display: block;
  font-size: 26rpx;
  color: var(--acm-text-muted);
  line-height: 1.5;
}

.warn-card {
  border: 2rpx solid var(--acm-border-warning);
  background: linear-gradient(135deg, var(--acm-bg-warning-soft), var(--acm-bg-warning-soft-2));
  border-radius: 32rpx;
  padding: 32rpx;
  margin-bottom: 20rpx;
}

.warn-title {
  display: flex;
  align-items: center;
  gap: 8rpx;
  font-size: 32rpx;
  color: var(--acm-warning-deep);
  margin-bottom: 20rpx;
  font-weight: 600;
}

.warn-list {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.warn-item {
  display: flex;
  align-items: flex-start;
  gap: 12rpx;
  font-size: 26rpx;
  color: var(--acm-warning-muted);
  line-height: 1.6;
}

.action-buttons {
  display: flex;
  gap: 16rpx;
  margin-bottom: 20rpx;
}

.action-btn {
  flex: 1;
  border: 0;
  border-radius: 24rpx;
  font-size: 28rpx;
  padding: 28rpx 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  transition: all 0.2s ease;
}

.action-btn-primary {
  background: linear-gradient(135deg, var(--acm-primary), var(--acm-primary-light));
  color: var(--acm-white);
  box-shadow: var(--acm-shadow-md);
}

.action-btn-primary:active {
  transform: scale(0.98);
}

.action-btn-secondary {
  background: var(--acm-white);
  color: var(--acm-text-secondary);
  border: 2rpx solid var(--acm-border-soft);
  box-shadow: var(--acm-shadow-sm);
}

.action-btn-secondary:active {
  background: var(--acm-bg-soft);
}

.action-btn-favorited {
  background: var(--acm-bg-soft);
  color: var(--acm-danger);
  border: 2rpx solid var(--acm-danger);
}

.bottom-text {
  text-align: center;
  color: var(--acm-text-subtle);
  font-size: 24rpx;
  padding: 32rpx 0;
}

.nav-gap {
  height: 48rpx;
}

/* Round 2 visual convergence: recommendation detail as field operation plan */
.page {
  background: var(--acm-bg-app);
}

.header {
  position: relative;
  overflow: hidden;
  background:
    linear-gradient(180deg, rgba(37, 84, 58, 0.9), rgba(54, 125, 73, 0.58)),
    url('/static/images/field-command/field-market-tomatoes.jpg');
  background-size: cover;
  background-position: right center;
  box-shadow: 0 18rpx 42rpx rgba(37, 84, 58, 0.15);
}

.match-card,
.card,
.warn-card {
  border-width: 1rpx;
  border-color: rgba(207, 222, 202, 0.86);
  box-shadow: 0 8rpx 22rpx rgba(64, 84, 62, 0.055);
  background: linear-gradient(180deg, rgba(255, 254, 249, 0.98), rgba(248, 251, 245, 0.96));
}

.income-item,
.match-reason,
.benefit-item,
.step-item,
.warn-item {
  border-color: rgba(200, 222, 197, 0.62);
  background: rgba(255, 254, 249, 0.72);
}

.action-btn-primary {
  background: var(--acm-brand-primary);
  box-shadow: 0 10rpx 22rpx rgba(37, 84, 58, 0.16);
}
</style>
