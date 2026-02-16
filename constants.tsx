
import { VoiceName, VoiceOption } from './types';

export const VOICE_OPTIONS: VoiceOption[] = [
  { id: VoiceName.ZEPHYR, name: 'Zephyr', description: 'Suara lembut dan membantu', gender: 'Wanita' },
  { id: VoiceName.PUCK, name: 'Puck', description: 'Suara muda, enerjik, dan ceria', gender: 'Pria' },
  { id: VoiceName.CHARON, name: 'Charon', description: 'Suara dalam, tenang, dan bijak', gender: 'Pria' },
  { id: VoiceName.KORE, name: 'Kore', description: 'Suara elegan dan profesional', gender: 'Wanita' },
  { id: VoiceName.FENRIR, name: 'Fenrir', description: 'Suara tegas dan berwibawa', gender: 'Pria' },
];

export const SYSTEM_INSTRUCTION = `
Anda adalah AI pengubah suara real-time yang ramah. 
Tugas utama Anda adalah berbicara dengan pengguna dalam bahasa Indonesia.
Gunakan nada bicara yang natural dan sesuaikan dengan karakter suara yang dipilih.
Tetaplah membantu dan berikan respon yang singkat namun bermakna.
`;
