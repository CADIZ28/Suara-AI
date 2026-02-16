
export enum VoiceName {
  ZEPHYR = 'Zephyr',
  PUCK = 'Puck',
  CHARON = 'Charon',
  KORE = 'Kore',
  FENRIR = 'Fenrir'
}

export interface VoiceOption {
  id: VoiceName;
  name: string;
  description: string;
  gender: 'Pria' | 'Wanita' | 'Netral';
}

export interface Message {
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
}
