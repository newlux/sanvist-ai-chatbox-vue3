/** 机型选项（/user/device-models 返回的 models 元素） */
export interface DeviceModelOption {
  /** 机型标识，选中后作为 inputs.device_model 的值透传给 Dify */
  modelKey: string;
  /** 机型名称，选项卡展示文案 */
  modelName: string;
}

export interface DeviceModelsData {
  models: DeviceModelOption[];
}
