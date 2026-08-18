<template>
  <button class="user-avatar-button acm-touchable" @click="goProfile">
    <view class="user-avatar-button__avatar">
      <image class="user-avatar-button__image" :src="avatarSrc" mode="aspectFill" />
    </view>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAuthStore } from '../../stores/auth'

const authStore = useAuthStore()

const DEFAULT_AVATAR = '/static/images/profile/default-farmer-avatar.svg'

const avatarSrc = computed(() => String(authStore.userInfo?.avatar || DEFAULT_AVATAR).trim())

const goProfile = () => {
  uni.navigateTo({ url: '/pages/profile/index' })
}
</script>

<style scoped lang="scss">
.user-avatar-button {
  position: relative;
  width: 88rpx;
  height: 88rpx;
  flex: 0 0 88rpx;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  box-shadow: none;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: visible;
  box-sizing: border-box;
  transition: transform 160ms ease;
}

.user-avatar-button:active {
  transform: scale(0.96);
}

.user-avatar-button::after {
  border: 0;
}

.user-avatar-button__avatar {
  width: 68rpx;
  height: 68rpx;
  flex: 0 0 68rpx;
  border: 2rpx solid rgba(255, 254, 247, 0.72);
  border-radius: 50%;
  background: rgba(255, 254, 247, 0.9);
  box-shadow: 0 6rpx 16rpx rgba(27, 62, 39, 0.12);
  overflow: hidden;
  box-sizing: border-box;
}

.user-avatar-button__image {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  display: block;
}

</style>
