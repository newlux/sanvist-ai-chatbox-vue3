<script>
export default {
  name: "FhToast",
  components: {},
  props: {
    fixed: {
      default: false,
      type: Boolean,
    },
    loading: {
      default: false,
      type: Boolean,
    },
    isSlot: {
      default: false, // slot 是否使用插槽
      type: Boolean,
    },
  },
  data() {
    let _this = this;
    return {
      showAble: false,
      title: null,
      //   isHTMLString: false,
      //   isLoading: false,
      icon: "",
      src: "",
      list: [
        {
          type: "success",
          src: _this.$getImage("toast_success_icon.png"),
        },
        {
          type: "loading",
          src: _this.$getImage("toast_loading_icon.png"),
        },
      ],
    };
  },
  computed: {
    iconCpt() {
      let src = "";
      let obj = this.list.find(e => e.type == this.icon);
      if (obj && obj.src) {
        src = obj.src;
      }
      return src;
    },
  },
  watch: {
    loading(val) {
      if (val) {
        this.showLoading({
          title: this.$t("loading"),
        });
      } else {
        this.hide();
      }
    },
  },
  methods: {
    /**
     * title：弹框内容；isHTMLString：是否传入html；isLoading：是否展示加载中图标；icon：图标类型
     */
    showToast({ icon, title, duration = 1500 }) {
      this.showAble = true;
      this.title = title;
      this.icon = icon;
      if (duration) {
        const time = setTimeout(() => {
          this.hideLoading();
          clearTimeout(time);
        }, duration);
      }
    },

    showLoading({ title, duration }) {
      this.showAble = true;
      this.title = title;
      this.icon = "loading";
      if (duration) {
        const time = setTimeout(() => {
          this.hideLoading();
          clearTimeout(time);
        }, duration);
      }
    },

    changeToast({ icon, title, duration = 1500 }) {
      this.title = title;
      this.icon = icon;
      if (duration) {
        const time = setTimeout(() => {
          this.hideLoading();
          clearTimeout(time);
        }, duration);
      }
    },

    // 关闭loading
    hideLoading() {
      this.showAble = false;
    },

    // 关闭所有(预留)
    hide() {
      this.showAble = false;
    },
  },
};
</script>

<template>
  <view v-if="showAble">
    <view class="fh-toast" :class="{ fixed }">
      <view class="m-toast-warp">
        <view v-if="icon != 'fail'" class="m-toast-warp-icon">
          <image
            class="m-toast-warp-icon-img"
            :class="
              icon === 'loading' ? 'm-toast-loading' : 'm-toast-loading-end'
            "
            :src="iconCpt"
          />
        </view>
        <view v-if="isSlot" class="m-toast-warp-msg">
          <slot />
        </view>
        <view v-else class="m-toast-warp-msg">
          {{ title }}
        </view>
      </view>
    </view>
    <view v-if="showAble" class="fh-toast-mask" />
  </view>
</template>

<style scoped lang="scss">
.fh-toast {
  position: absolute;
  z-index: 20001;
  bottom: 132px;
  background-repeat: no-repeat;
  display: flex;
  width: 750rpx;
  align-content: center;
  justify-content: center;
  &.fixed {
    position: fixed;
  }
}

.fh-toast-mask {
  position: fixed;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  z-index: 20000;
}

.m-toast-warp {
  background-color: rgba(0, 0, 0, 0.85);
  padding: 12px 16px;
  display: flex;
  align-items: center;
  // margin: 0px 32px;
  border-radius: 35px;
  display: flex;
  max-width: 700rpx;
}

.m-toast-warp-icon {
  width: 24px;
  height: 24px;
  margin-right: 10px;
  display: flex;
  align-items: center;
}

.m-toast-warp-icon-img {
  width: 24px;
  height: 24px;
}

.m-toast-loading {
  -webkit-animation: rotate 2s linear infinite;
  animation: rotate 2s linear infinite;
}

.m-toast-loading-end {
  animation: none !important;
}

.m-toast-warp-msg {
  color: #fff;
  font-family: PingFang SC;
  font-size: 14px;
  font-style: normal;
  font-weight: 400;
  line-height: 16px;
  overflow-wrap: anywhere;
  max-width: 475rpx;
}

@keyframes rotate {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

@-webkit-keyframes rotate {
  0% {
    -webkit-transform: rotate(0deg);
  }
  100% {
    -webkit-transform: rotate(360deg);
  }
}
</style>
