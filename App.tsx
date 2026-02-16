
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { VoiceName, VoiceOption, Message } from './types';
import { VOICE_OPTIONS, SYSTEM_INSTRUCTION } from './constants';
import AudioVisualizer from './components/AudioVisualizer';

// --- Utility Functions ---
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

function createBlob(data: Float32Array): any {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}

const App: React.FC = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<VoiceName>(VoiceName.ZEPHYR);
  const [messages, setMessages] = useState<Message[]>([]);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const sessionRef = useRef<any>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const chatEndRef = useRef<HTMLDivElement>(null);

  // State to track transcriptions
  const [currentInputText, setCurrentInputText] = useState('');
  const [currentOutputText, setCurrentOutputText] = useState('');

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, currentInputText, currentOutputText]);

  const toggleConnection = async () => {
    if (isConnected) {
      handleDisconnect();
    } else {
      await handleConnect();
    }
  };

  const handleDisconnect = () => {
    if (sessionRef.current) {
      sessionRef.current.close();
    }
    if (micStream) {
      micStream.getTracks().forEach(track => track.stop());
    }
    inputAudioCtxRef.current?.close();
    outputAudioCtxRef.current?.close();
    
    setIsConnected(false);
    setMicStream(null);
    setIsProcessing(false);
  };

  const handleConnect = async () => {
    try {
      setIsProcessing(true);
      setError(null);
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicStream(stream);

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      inputAudioCtxRef.current = inputCtx;
      outputAudioCtxRef.current = outputCtx;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice } },
          },
          systemInstruction: SYSTEM_INSTRUCTION,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            console.log('Gemini Live API connected');
            setIsConnected(true);
            setIsProcessing(false);

            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Audio output
            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioData) {
              const ctx = outputAudioCtxRef.current!;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              
              const buffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(ctx.destination);
              
              source.addEventListener('ended', () => {
                sourcesRef.current.delete(source);
              });
              
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              sourcesRef.current.add(source);
            }

            // Handle Interruptions
            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => s.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }

            // Handle Transcriptions
            if (message.serverContent?.inputTranscription) {
              setCurrentInputText(prev => prev + message.serverContent!.inputTranscription!.text);
            }
            if (message.serverContent?.outputTranscription) {
              setCurrentOutputText(prev => prev + message.serverContent!.outputTranscription!.text);
            }

            if (message.serverContent?.turnComplete) {
              setMessages(prev => [
                ...prev,
                { role: 'user', text: currentInputText, timestamp: new Date() },
                { role: 'model', text: currentOutputText, timestamp: new Date() }
              ]);
              setCurrentInputText('');
              setCurrentOutputText('');
            }
          },
          onerror: (e) => {
            console.error('Gemini error:', e);
            setError("Koneksi gagal. Silakan coba lagi.");
            handleDisconnect();
          },
          onclose: () => {
            console.log('Gemini closed');
            handleDisconnect();
          }
        }
      });

      sessionRef.current = await sessionPromise;

    } catch (err: any) {
      console.error(err);
      setError("Gagal mengakses mikrofon atau menghubungkan ke AI.");
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 md:p-8">
      {/* Header */}
      <div className="w-full max-w-4xl flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center glow-blue">
            <i className="fa-solid fa-microphone-lines text-white text-xl"></i>
          </div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
            SuaraKita AI
          </h1>
        </div>
        <div className="flex items-center gap-2">
           <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`}></span>
           <span className="text-xs text-gray-400 font-medium tracking-wider uppercase">
             {isConnected ? 'LIVE' : 'OFFLINE'}
           </span>
        </div>
      </div>

      <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 mb-24">
        {/* Sidebar Settings */}
        <div className="lg:col-span-1 space-y-6">
          <div className="glass p-6 rounded-2xl">
            <h2 className="text-sm font-semibold text-gray-400 mb-4 uppercase tracking-widest">Pilih Suara</h2>
            <div className="space-y-3">
              {VOICE_OPTIONS.map(voice => (
                <button
                  key={voice.id}
                  onClick={() => !isConnected && setSelectedVoice(voice.id)}
                  disabled={isConnected}
                  className={`w-full text-left p-4 rounded-xl transition-all ${
                    selectedVoice === voice.id 
                    ? 'bg-blue-600/20 border border-blue-500/50' 
                    : 'bg-white/5 border border-transparent hover:bg-white/10'
                  } ${isConnected ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-white">{voice.name}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                      voice.gender === 'Pria' ? 'border-blue-400 text-blue-400' : 'border-pink-400 text-pink-400'
                    }`}>
                      {voice.gender}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400">{voice.description}</p>
                </button>
              ))}
            </div>
            {isConnected && (
              <p className="text-[10px] text-yellow-500/80 mt-4 italic">
                *Matikan koneksi untuk mengganti suara.
              </p>
            )}
          </div>

          <div className="glass p-6 rounded-2xl">
            <h2 className="text-sm font-semibold text-gray-400 mb-4 uppercase tracking-widest">Informasi</h2>
            <p className="text-xs text-gray-300 leading-relaxed">
              Aplikasi ini menggunakan teknologi Gemini 2.5 Flash untuk memproses audio Anda secara real-time. 
              Karakter suara yang dipilih akan menanggapi apa pun yang Anda katakan.
            </p>
          </div>
        </div>

        {/* Chat / Visualizer Area */}
        <div className="lg:col-span-2 flex flex-col gap-6 h-[600px] lg:h-auto">
          {/* Main Display */}
          <div className="glass rounded-3xl p-8 flex-1 flex flex-col items-center justify-center relative overflow-hidden">
             {/* Visual Background Glow */}
             <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 rounded-full blur-[100px] transition-all duration-1000 ${
               isConnected ? 'bg-blue-600/30' : 'bg-gray-600/10'
             }`}></div>

             {!isConnected ? (
               <div className="text-center z-10">
                 <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-6 border border-white/10">
                   <i className="fa-solid fa-microphone text-4xl text-gray-500"></i>
                 </div>
                 <h3 className="text-xl font-bold text-white mb-2">Siap untuk Mulai?</h3>
                 <p className="text-gray-400 text-sm max-w-xs mx-auto">
                   Klik tombol di bawah untuk mulai berbicara dengan AI menggunakan suara yang berbeda.
                 </p>
               </div>
             ) : (
               <div className="w-full flex flex-col items-center justify-center gap-12 z-10">
                  <div className="text-center">
                    <div className="relative inline-block">
                      <div className="w-32 h-32 bg-blue-600/20 rounded-full flex items-center justify-center border-2 border-blue-500/50 glow-blue animate-pulse">
                         <i className="fa-solid fa-headset text-5xl text-blue-400"></i>
                      </div>
                      <div className="absolute -bottom-2 -right-2 bg-green-500 w-8 h-8 rounded-full border-4 border-[#0a0a0b] flex items-center justify-center">
                         <i className="fa-solid fa-bolt text-xs text-white"></i>
                      </div>
                    </div>
                    <h3 className="mt-6 text-2xl font-bold tracking-tight">{VOICE_OPTIONS.find(v => v.id === selectedVoice)?.name} Sedang Mendengar...</h3>
                  </div>

                  <div className="w-full max-w-md space-y-4">
                    <div className="bg-white/5 p-4 rounded-2xl border border-white/10">
                      <p className="text-[10px] text-gray-500 mb-2 uppercase tracking-widest font-bold">Input Anda</p>
                      <AudioVisualizer isActive={isConnected} color="#3b82f6" stream={micStream || undefined} />
                      <p className="text-sm text-gray-300 italic min-h-[1.5rem]">
                        {currentInputText || (isConnected && "Mulai bicara...")}
                      </p>
                    </div>

                    <div className="bg-blue-500/5 p-4 rounded-2xl border border-blue-500/20">
                      <p className="text-[10px] text-blue-400/80 mb-2 uppercase tracking-widest font-bold">Respon AI</p>
                      <p className="text-sm text-white min-h-[1.5rem] leading-relaxed">
                        {currentOutputText}
                      </p>
                    </div>
                  </div>
               </div>
             )}
          </div>

          {/* Chat History Drawer */}
          <div className="glass rounded-2xl p-4 overflow-y-auto max-h-48 scrollbar-hide">
            <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3">Riwayat Percakapan</h4>
            {messages.length === 0 ? (
              <p className="text-xs text-gray-600 italic">Belum ada percakapan...</p>
            ) : (
              <div className="space-y-3">
                {messages.map((m, i) => (
                  <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] p-2 rounded-lg text-xs ${
                      m.role === 'user' ? 'bg-white/5 text-gray-300' : 'bg-blue-600/20 text-blue-100 border border-blue-500/20'
                    }`}>
                      {m.text}
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef}></div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Floating Controls */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-md px-4 z-50">
        <div className="glass p-4 rounded-3xl flex items-center justify-between shadow-2xl border border-white/10">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
            <div>
              <p className="text-xs font-bold text-white leading-none mb-1">
                {isConnected ? 'Sesi Aktif' : 'Sesi Tidak Aktif'}
              </p>
              <p className="text-[10px] text-gray-500">
                {isConnected ? `Bicara dengan ${selectedVoice}` : 'Tekan tombol untuk mulai'}
              </p>
            </div>
          </div>

          <button
            onClick={toggleConnection}
            disabled={isProcessing}
            className={`px-8 py-3 rounded-2xl font-bold text-sm transition-all flex items-center gap-2 ${
              isConnected 
              ? 'bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500 hover:text-white' 
              : 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg glow-blue'
            } ${isProcessing ? 'opacity-50 cursor-wait' : ''}`}
          >
            {isProcessing ? (
               <i className="fa-solid fa-spinner fa-spin"></i>
            ) : (
              <i className={`fa-solid ${isConnected ? 'fa-phone-slash' : 'fa-play'}`}></i>
            )}
            {isConnected ? 'Akhiri Sesi' : 'Mulai Sekarang'}
          </button>
        </div>
        {error && (
          <div className="mt-4 bg-red-500/20 text-red-400 border border-red-500/30 p-2 rounded-xl text-[10px] text-center">
            {error}
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
