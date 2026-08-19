export interface RoleOptionDeviceType {
  deviceType: string;
  deviceTypeName: string;
  count: number;
}

export interface RoleOption {
  roleCode: string;
  roleName: string;
  deviceCount: number;
  deviceTypeSummary: RoleOptionDeviceType[];
}

export interface RoleOptionsData {
  roles: RoleOption[];
}

export type AwakeningDeviceStatus = "online" | "offline" | string;

export interface AwakeningInputDevice {
  deviceId: string;
  deviceNo: string;
  deviceName: string;
  deviceType: string;
  deviceModel?: string;
  status: AwakeningDeviceStatus;
}

export interface AwakeningPrompt {
  type: "awakening" | string;
  bizDate: string;
  userId: string;
  userName: string;
  roleCode: string;
  roleName: string;
  deviceCount: number;
  selectedDeviceNo?: string;
  title: string;
  content: string;
  inputDeviceList?: AwakeningInputDevice[];
  outDeviceList?: AwakeningInputDevice[] | null;
  status: "READY" | string;
  batchNo: string;
}
