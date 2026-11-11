/** 欢迎首页与对话输入栏共用的附件占位提示。 */
export function showAttachmentComingSoon() {
  uni.showToast({
    title: '附件上传功能即将上线',
    icon: 'none',
    duration: 2000,
  });
}
