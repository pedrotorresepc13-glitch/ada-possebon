import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.tsx';

interface SpeechResult {
  readonly isFinal: boolean;
  readonly [index: number]: { transcript: string };
}
interface SpeechResultEvent {
  readonly results: ArrayLike<SpeechResult>;
}
interface SpeechRecognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
interface SpeechBrowser extends Window {
  SpeechRecognition?: new () => SpeechRecognizer;
  webkitSpeechRecognition?: new () => SpeechRecognizer;
}

/** Ditado no campo: não abre sessão Live nem envia a mensagem automaticamente. */
export function VoiceDictation({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const recognition = useRef<SpeechRecognizer | null>(null);

  useEffect(() => () => {
    if (recognition.current) {
      recognition.current.onresult = null;
      recognition.current.onerror = null;
      recognition.current.onend = null;
      recognition.current.abort();
    }
  }, []);

  function toggle() {
    if (recognition.current) {
      recognition.current.stop();
      return;
    }
    setError('');
    const speech = window as SpeechBrowser;
    const Constructor = speech.SpeechRecognition ?? speech.webkitSpeechRecognition;
    if (!Constructor) {
      setError('Ditado indisponível neste navegador. Experimente o Chrome ou Edge atualizado.');
      return;
    }
    const instance = new Constructor();
    recognition.current = instance;
    instance.lang = 'pt-BR';
    instance.continuous = true;
    instance.interimResults = true;
    const original = value.trimEnd();
    const prefix = original ? original + ' ' : '';
    instance.onresult = (event) => {
      let spoken = '';
      for (let i = 0; i < event.results.length; i++) {
        spoken += event.results[i]?.[0]?.transcript ?? '';
      }
      onChange((prefix + spoken).slice(0, 4000));
    };
    instance.onerror = (event) => {
      const errors: Record<string, string> = {
        'not-allowed': 'Permita o acesso ao microfone nas configurações do navegador.',
        'service-not-allowed': 'O reconhecimento de fala foi bloqueado pelo navegador.',
        'audio-capture': 'Não foi possível acessar o microfone.',
        'network': 'O serviço de reconhecimento de voz está indisponível.',
        'no-speech': 'Não foi detectada fala. Tente novamente.'
      };
      setError(errors[event.error] ?? 'Não foi possível transcrever o áudio.');
    };
    instance.onend = () => {
      recognition.current = null;
      setListening(false);
    };
    try {
      instance.start();
      setListening(true);
    } catch {
      recognition.current = null;
      setListening(false);
      setError('Não foi possível iniciar o ditado. Verifique a permissão do microfone.');
    }
  }

  return <>
    <button type="button" className={listening ? 'composer-mic listening' : 'composer-mic'}
      aria-label={listening ? 'Parar ditado' : 'Ditar mensagem'}
      aria-pressed={listening} title={listening ? 'Parar ditado' : 'Ditar mensagem por voz'}
      onClick={toggle}>
      <Icon name="mic" size={20} />
    </button>
    {error && <span className="dictation-error" role="alert">{error}</span>}
  </>;
}
