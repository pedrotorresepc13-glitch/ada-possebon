import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.tsx';
import { api } from '../api.ts';

interface ChatAnswer {
  conversationId: string;
  message: { id: string; role: 'assistant'; content: string; metadata?: Record<string, unknown>; createdAt?: string };
}
interface LiveEvent {
  type?: string;
  delta?: string;
  start_ms?: number;
  end_ms?: number;
  offset_ms?: number;
  delegation?: { id?: string; target?: string };
  error?: { message?: string };
}
interface Props {
  conversationId?: string;
  onAnswer: (answer: ChatAnswer & { userText: string }) => void;
}

/** GPT-Live usa WebRTC para áudio; toda consulta continua passando pelo /chat autenticado da Ada. */
export function LiveVoice({ conversationId, onAnswer }: Props) {
  const [status, setStatus] = useState<'parado' | 'conectando' | 'ativo'>('parado');
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);
  const attempt = useRef(0);
  const [caption, setCaption] = useState('');
  const pc = useRef<RTCPeerConnection | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const dc = useRef<RTCDataChannel | null>(null);
  const speaker = useRef<HTMLAudioElement | null>(null);
  const conversation = useRef(conversationId);
  const latestCallback = useRef(onAnswer);
  const active = useRef(false);
  const startedAt = useRef(0);
  const segments = useRef<{ start: number; end: number; text: string }[]>([]);
  const lastOffset = useRef(-1);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const connectionTimer = useRef<number | undefined>(undefined);

  useEffect(() => { conversation.current = conversationId; latestCallback.current = onAnswer; }, [conversationId, onAnswer]);

  const cleanup = () => {
    window.clearTimeout(connectionTimer.current);
    attempt.current++;
    active.current = false;
    if (dc.current?.readyState === 'open') {
      try { dc.current.send(JSON.stringify({ type: 'session.close', event_id: 'ada-close-' + Date.now() })); }
      catch { /* conexão já fechou */ }
    }
    dc.current?.close();
    pc.current?.close();
    mic.current?.getTracks().forEach(t => t.stop());
    if (speaker.current) { speaker.current.pause(); speaker.current.srcObject = null; speaker.current.remove(); }
    dc.current = null; pc.current = null; mic.current = null; speaker.current = null;
  };

  const stop = () => {
    cleanup();
    segments.current = [];
    lastOffset.current = -1;
    setStatus('parado');
    setCaption('');
    setProcessing(false);
  };

  useEffect(() => () => {
    window.clearTimeout(connectionTimer.current);
    attempt.current++;
    active.current = false;
    dc.current?.close(); pc.current?.close();
    mic.current?.getTracks().forEach(t => t.stop());
    speaker.current?.remove();
  }, []);

  function appendResult(id: string, text: string) {
    const channel = dc.current;
    if (!active.current || channel?.readyState !== 'open') return;
    const parts = (text.match(/[\s\S]{1,600}/g) ?? ['Não obtive um resultado.']).slice(0, 12);
    for (const part of parts) {
      channel.send(JSON.stringify({
        type: 'session.commentary.append', event_id: 'ada-result-' + crypto.randomUUID(),
        delegation_id: id, content: part
      }));
    }
  }

  async function delegate(id: string, offset: number, generation: number) {
    // Os trechos de transcrição chegam de forma incremental; aguarda os últimos fragmentos.
    await new Promise<void>(resolve => window.setTimeout(resolve, 300));
    if (generation !== attempt.current || !active.current) return;
    const parts = segments.current.filter(p => p.end > lastOffset.current && p.start <= offset + 1200);
    const question = parts.map(p => p.text).join('').trim();
    lastOffset.current = Math.max(lastOffset.current, offset);
    segments.current = segments.current.filter(p => p.end > lastOffset.current);
    if (!question) {
      appendResult(id, 'Não foi possível transcrever a solicitação por completo. Peça que a pessoa repita.');
      return;
    }
    setProcessing(true);
    try {
      const result = await api<ChatAnswer>('/chat', { body: { message: question, conversationId: conversation.current } });
      if (generation !== attempt.current) return;
      conversation.current = result.conversationId;
      latestCallback.current({ ...result, userText: question });
      appendResult(id, result.message.content || 'A consulta não trouxe informações suficientes.');
    } catch (e) {
      if (generation === attempt.current) appendResult(id, 'Não foi possível concluir a consulta ao POSSEBON. ' + (e as Error).message.slice(0, 160));
    } finally {
      if (generation === attempt.current) setProcessing(false);
    }
  }

  async function start() {
    if (status !== 'parado') return;
    const generation = ++attempt.current;
    queue.current = Promise.resolve();
    setError(''); setStatus('conectando');
    connectionTimer.current = window.setTimeout(() => {
      if (generation !== attempt.current) return;
      stop();
      setError('A conexão de voz demorou mais que o esperado. Tente novamente.');
    }, 20000);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('O microfone requer HTTPS e permissão do navegador.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (generation !== attempt.current) { stream.getTracks().forEach(t => t.stop()); return; }
      mic.current = stream;
      const peer = new RTCPeerConnection(); pc.current = peer;
      stream.getTracks().forEach(t => peer.addTrack(t, stream));
      const audio = document.createElement('audio');
      audio.autoplay = true; audio.setAttribute('playsinline', 'true'); audio.hidden = true;
      document.body.appendChild(audio); speaker.current = audio;
      peer.ontrack = event => {
        audio.srcObject = event.streams[0] ?? null;
        void audio.play().catch(() => setError('Autorize a reprodução de áudio no navegador.'));
      };
      const channel = peer.createDataChannel('oai-events'); dc.current = channel;
      channel.onmessage = message => {
        if (generation !== attempt.current) return;
        let event: LiveEvent;
        try { event = JSON.parse(String(message.data)) as LiveEvent; } catch { return; }
        if (event.type === 'session.input_transcript.delta' && event.delta) {
          const start = event.start_ms ?? event.offset_ms ?? 0;
          const end = event.end_ms ?? start + 100;
          segments.current.push({ start, end, text: event.delta });
          setCaption(s => (s + event.delta).slice(-350));
        }
        if (event.type === 'session.delegation.created' && event.delegation?.id && event.delegation.target === 'client') {
          const id = event.delegation.id;
          if (channel.readyState === 'open') channel.send(JSON.stringify({
            type: 'session.thinking.append', event_id: 'ada-pending-' + crypto.randomUUID(),
            delegation_id: id, content: ''
          }));
          queue.current = queue.current.then(() => delegate(id, event.offset_ms ?? 0, generation)).catch(() => undefined);
        }
        if (event.type === 'error') setError(event.error?.message ?? 'Erro na sessão de voz.');
        if (event.type === 'session.closed') stop();
      };
      const offer = await peer.createOffer(); await peer.setLocalDescription(offer);
      const remote = await api<{ sdp: string; sessionId: string }>('/voice/live/session', { body: { sdp: peer.localDescription?.sdp } });
      if (generation !== attempt.current) return;
      await peer.setRemoteDescription({ type: 'answer', sdp: remote.sdp });
      if (generation !== attempt.current) return;
      peer.onconnectionstatechange = () => {
        if (generation !== attempt.current) return;
        if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
          stop();
          setError('A conexão de voz foi interrompida. Você pode iniciar novamente.');
        }
      };
      const ready = () => {
        if (generation !== attempt.current) return;
        window.clearTimeout(connectionTimer.current);
        active.current = true;
        startedAt.current = Date.now();
        setStatus('ativo');
      };
      if (channel.readyState === 'open') ready();
      else channel.onopen = ready;
    } catch (e) {
      if (generation !== attempt.current) return;
      cleanup(); setStatus('parado');
      const denied = e instanceof DOMException && e.name === 'NotAllowedError';
      setError(denied ? 'Microfone bloqueado. Abra as permissões do site no navegador, permita o microfone e tente novamente.' : (e as Error).message);
    }
  }

  // Evita sessões abandonadas e custos inesperados; não substitui controles de consumo na OpenAI.
  useEffect(() => {
    if (status !== 'ativo') return;
    const timer = window.setInterval(() => {
      if (Date.now() - startedAt.current > 10 * 60 * 1000) {
        stop(); setError('A conversa foi encerrada após 10 minutos para controlar o custo.');
      }
    }, 1000);
    const pageHide = () => { cleanup(); };
    window.addEventListener('pagehide', pageHide);
    return () => { window.clearInterval(timer); window.removeEventListener('pagehide', pageHide); };
  }, [status]);

  const label = status === 'conectando' ? 'Conectando' : processing ? 'Consultando o POSSEBON' : 'Voz ativa';

  return <section className="voice-control" aria-label="Conversa por voz">
    {status === 'parado' ? (
      <button type="button" className="btn sm voice-start" onClick={() => void start()}>
        <Icon name="spark" size={17} /> Conversar por voz
      </button>
    ) : (
      <div className="voice-stage" data-state={processing ? 'processing' : status}>
        <div className="voice-orb" aria-hidden="true"><Icon name="spark" size={29} /></div>
        <strong role="status">{label}</strong>
        <span className="small">{status === 'ativo' ? 'Fale naturalmente. A conversa fica salva no chat.' : 'Preparando o áudio do navegador.'}</span>
        {caption && <p className="voice-caption">{caption}</p>}
        <button type="button" className="btn sm voice-stop" onClick={stop}>
          {status === 'conectando' ? 'Cancelar' : 'Encerrar voz'}
        </button>
      </div>
    )}
    {error && <div className="error-box" role="alert">{error}</div>}
  </section>;
}
