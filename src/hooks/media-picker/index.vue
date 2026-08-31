<template>
  <view class="media-picker" v-if="showCard">
    <view class="media-picker-card">
      <view v-if="!hideTitle" class="media-picker-title">{{ title || '附件' }}</view>

      <!-- 图片 -->
      <view class="media-section" v-if="showImageSection">
        <view class="section-title">
          <text>{{ imageTitle || $t("pictures") }}</text>
          <text class="picker-numbers">{{ imageCountText }}</text>
        </view>
        <view class="media-grid">
          <view v-for="(item, index) in imageList" :index="index" :key="item.imgUrl || index" class="grid-cell">
            <view :class="['preview-content', 'flex', isRtl && 'preview_rtl']">
              <image class="preview-img" :src="item.imgUrl || item" @click="previewImage(index)" mode="aspectFill" />
              <image v-if="!disabled" class="delete-img" @click="removeImage(index)"
                :src="$getImage('picker-image/close.png')" />
            </view>
          </view>
          <!-- 添加按钮 -->
          <view :index="10000" v-if="!disabled && imageList.length < imageMaxCount" class="grid-cell">
            <view @click="openImagePicker" :class="['image_wrap', isRtl && 'image_rtl']">
              <image class="img_add_svg" src="/static/picker-image/add-icon.svg" />
            </view>
          </view>
          <!-- 占位元素：最后一行不足3个时补齐，保证布局均匀 -->
          <view v-for="n in placeholderCount" :key="'placeholder-' + n" class="grid-cell grid-cell-placeholder" />
        </view>
      </view>

      <!-- 视频 -->
      <!-- <view class="media-section" v-if="showVideoSection">
        <view class="section-title">
          <text>{{ videoTitle || $t("video") }}</text>
          <text class="picker-numbers">{{ videoCountText }}</text>
        </view>
        <uni-grid :column="3" :showBorder="false" :highlight="false">
          <uni-grid-item v-for="(item, index) in videoList" :index="index" :key="item.imgUrl || index">
            <view :class="['preview-content', 'flex', isRtl && 'preview_rtl']">
              <image class="preview-img" :src="item.imgUrl" mode="aspectFill" />
              <image class="preview-play" :src="$getImage('play.png')" @click="playVideo(index)" />
              <image v-if="!disabled" class="delete-img" @click="removeVideo(index)"
                :src="$getImage('picker-image/close.png')" />
            </view>
          </uni-grid-item>
          <uni-grid-item :index="10001" v-if="!disabled && videoList.length < videoMaxCount">
            <view @click="addVideo" :class="['image_wrap', isRtl && 'image_rtl']">
              <image class="img_add" :src="$getImage('picker-image/add-image.png')" />
            </view>
          </uni-grid-item>
        </uni-grid>
      </view> -->
    </view>

    <!-- 图片选择弹框 -->
    <uni-popup ref="pickerPopup" type="dialog" style="position: fixed; z-index: 110">
      <view class="picker-modal">
        <view class="p-btn" @click="() => goRequestPermission('album')">{{ $t('choose-from-album') }}</view>
        <view class="p-btn" @click="() => goRequestPermission('camera')">{{ $t('take-a-photo') }}</view>
      </view>
    </uni-popup>

    <fh-toast ref="fhToast" :fixed="true" />
  </view>
</template>

<script>
import { uploadFiles } from "@/utils/fetch/upload-file";
import { mapState } from "vuex";

export default {
  props: {
    title: { type: String, default: "" },
    imageTitle: { type: String, default: "" },
    videoTitle: { type: String, default: "" },
    images: { type: Array, default: () => [] },
    videos: { type: Array, default: () => [] },
    imageMaxCount: { type: Number, default: 9 },
    videoMaxCount: { type: Number, default: 3 },
    disabled: { type: Boolean, default: false },
    hideTitle: { type: Boolean, default: false },
  },
  computed: {
    ...mapState({ isRtl: "isRtl", appVersion: "appVersion", isIOS: "isIOS" }),
    showCard() {
      return !this.disabled || this.imageList.length > 0 || this.videoList.length > 0;
    },
    showImageSection() {
      return !this.disabled || this.imageList.length > 0;
    },
    showVideoSection() {
      return !this.disabled || this.videoList.length > 0;
    },
    imageCountText() {
      return this.disabled
        ? `(${this.imageList.length})`
        : `(${this.imageList.length}/${this.imageMaxCount})`;
    },
    videoCountText() {
      return this.disabled
        ? `(${this.videoList.length})`
        : `(${this.videoList.length}/${this.videoMaxCount})`;
    },
    isShowStatus() {
      return this.compareVersion(this.appVersion, "4.9.22") > 0;
    },
    // 计算需要补齐的占位元素数量（最后一行不足3个时）
    placeholderCount() {
      const total = this.imageList.length + (this.disabled ? 0 : (this.imageList.length < this.imageMaxCount ? 1 : 0));
      const remainder = total % 3;
      return remainder === 0 ? 0 : 3 - remainder;
    },
  },
  data() {
    return {
      imageList: [],
      videoList: [],
    };
  },
  watch: {
    images: {
      handler(images) {
        this.imageList = Array.isArray(images) ? images : [];
      },
      immediate: true,
    },
    videos: {
      handler(videos) {
        this.videoList = Array.isArray(videos)
          ? videos.map((item) => {
              if (typeof item === "string") {
                const urls = item.split(",,");
                return {
                  imgUrl: urls[0],
                  videoUrl: urls[1],
                  type: 2,
                };
              }
              return item;
            })
          : [];
      },
      immediate: true,
    },
  },
  mounted() {
  },
  methods: {
    compareVersion(currentVersion, targetVersion) {
      if (!currentVersion || !targetVersion) {
        return -1;
      }
      const currentArr = currentVersion.split('.').map(Number);
      const targetArr = targetVersion.split('.').map(Number);
      const maxLength = Math.max(currentArr.length, targetArr.length);
      for (let i = 0; i < maxLength; i++) {
        const currentNum = currentArr[i] || 0;
        const targetNum = targetArr[i] || 0;
        if (currentNum > targetNum) {
          return 1;
        } else if (currentNum < targetNum) {
          return -1;
        }
      }
      return 0;
    },
    openImagePicker() {
      if (this.isShowStatus && !this.isIOS) {
        AlipayJSBridge.call("imageChoose", { count: this.imageMaxCount - this.imageList.length }, (res) => {
          if (res && res.tempFilePaths && res.tempFilePaths.length > 0) {
            res.tempFilePaths.forEach((item) => {
              this.imageList.push({
                imgUrl: item,
                type: 1,
              });
            });
            this.updateImages();
          }
        });
      } else {
        this.$refs.pickerPopup.open();
      }
    },
    goRequestPermission(type) {
      const types = {
        album: "photo",
        camera: "camera",
      };
      AlipayJSBridge.call("requestPermission", {
        permissions: types[type],
      }, (res) => {
        if (res.result === '1') {
          this.handleChooseImage(type);
        } else if (res.result === '0') {
          if (type === 'album') {
            this.$refs.fhToast.showToast({
              title: this.$t('Please-authorize-access-to-the-photo-album-first.'),
              icon: "fail",
            });
          } else if (type === 'camera') {
            this.$refs.fhToast.showToast({
              title: this.$t('Please-authorize-access-to-the-camera-first.'),
              icon: "fail",
            });
          }
        } else {
          this.handleChooseImage(type);
        }
      });
    },
    handleChooseImage(sourceType) {
      this.$refs.pickerPopup.close();
      this.chooseImage(sourceType);
    },
    chooseImage(sourceType) {
      AlipayJSBridge.call(
        "chooseImage",
        {
          count: this.imageMaxCount - this.imageList.length,
          sourceType: [sourceType],
          sizeType: ["compressed"],
        },
        (result) => {
          let apFilePaths = [];
          if (typeof result.apFilePaths === "string") {
            try {
              apFilePaths = JSON.parse(result.apFilePaths);
            } catch (e) {
              apFilePaths = [];
            }
          } else if (Array.isArray(result.apFilePaths)) {
            apFilePaths = result.apFilePaths;
          }
          const localPaths =
            result.tempFilePaths && result.tempFilePaths.length
              ? result.tempFilePaths
              : null;
          if (localPaths) {
            this.uploadImages(localPaths);
            return;
          }
          if (apFilePaths && apFilePaths.length > 0) {
            Promise.all(
              apFilePaths.map(
                (url) =>
                  new Promise((resolve, reject) => {
                    uni.downloadFile({
                      url,
                      success: (res) => {
                        if (res.statusCode === 200) {
                          resolve(res.tempFilePath);
                        } else {
                          reject(res);
                        }
                      },
                      fail: reject,
                    });
                  })
              )
            )
              .then((paths) => {
                this.uploadImages(paths);
              })
              .catch((err) => {
                console.log("downloadFile error", err);
              });
          }
        }
      );
    },
    async uploadImages(paths) {
      const urls = await uploadFiles(paths.map((p) => ({ path: p, type: "image" })));
      const list = urls.filter((o) => o);
      if (!list.length) return;
      list.forEach((item) => this.imageList.push({ imgUrl: item, type: 1 }));
      this.updateImages();
    },
    removeImage(index) {
      this.imageList.splice(index, 1);
      this.updateImages();
    },
    previewImage(index) {
      const urls = this.imageList.map((item) => item.imgUrl || item);
      uni.previewImage({ urls, current: index });
    },
    addVideo() {
      AlipayJSBridge.call("videoUpload", { time: 180 }, (result) => {
        if (result && result.coverUrl && result.videoUrl) {
          this.videoList.push({
            imgUrl: result.coverUrl,
            videoUrl: result.videoUrl,
            type: 2,
          });
          this.updateVideos();
        }
      });
    },
    removeVideo(index) {
      this.videoList.splice(index, 1);
      this.updateVideos();
    },
    playVideo(index) {
      AlipayJSBridge.call("playSisVideo", { url: this.videoList[index].videoUrl });
    },
    updateImages() {
      this.$emit("update:images", [...this.imageList]);
      this.$emit("change", {
        images: [...this.imageList],
        videos: [...this.videoList],
      });
    },
    updateVideos() {
      this.$emit("update:videos", [...this.videoList]);
      this.$emit("change", {
        images: [...this.imageList],
        videos: [...this.videoList],
      });
    },
  },
};
</script>

<style lang="scss">
@import "./index.scss";
</style>
