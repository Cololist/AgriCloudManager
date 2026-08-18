<template>
  <button
    :class="['user-notice-bell', 'notification-button', variant === 'overlay' ? 'notification-button--overlay' : '']"
    aria-label="打开通知中心"
    @click="openNotifications"
  >
    <SvgIcon name="bell" :size="20" :color="iconColor" />
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import SvgIcon from '../SvgIcon.vue'

const props = withDefaults(defineProps<{ variant?: 'default' | 'overlay' }>(), {
  variant: 'default',
})

const iconColor = computed(() =>
  props.variant === 'overlay' ? 'var(--acm-text-inverse)' : 'var(--acm-text-secondary)',
)

const openNotifications = () => {
  uni.navigateTo({ url: '/pages/notification/index' })
}
</script>

<style scoped lang="scss">
.notification-button {
  flex: 0 0 72rpx;
}

.notification-button--overlay {
  width: 70rpx;
  height: 70rpx;
  min-width: 70rpx;
  flex-basis: 70rpx;
  border-color: rgba(255, 254, 247, 0.28);
  border-radius: 22rpx;
  background: rgba(255, 254, 247, 0.16);
  box-shadow: none;
}
</style>
