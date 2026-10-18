import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useHealthCheck, getHealthCheckQueryKey, useGetArenaStatus, getGetArenaStatusQueryKey } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import { io } from 'socket.io-client';
import {
  Activity, ArrowLeft, ArrowRight, Check, CircleHelp, Copy, Crown, DoorOpen, Eye,
  Flag, LoaderCircle, LockKeyhole, Radio, RotateCcw, ShieldCheck, Sparkles, Swords,
  Users, Wifi, WifiOff, X,
} from 'lucide-react';

type Team = 'A' | 'B' | null;
type GameMode = 'normal' | 'baseball';
type Phase = 'lobby' | 'playing' | 'finished';
type Player = { id: string; name: string; team: Team; connected: boolean };
type Delivery = {
  number: number;
  batterId: string;
  bowlerId: string;
  batterName: string;
  bowlerName: string;
  batterNumber: number;
  bowlerNumber: number;
  kind: 'run' | 'out' | 'strike' | 'strike-out';
  runs: number;
  strikeCount: number;
  message: string;
};
type Match = {
  inning: 1 | 2; battingTeam: 'A' | 'B'; scores: Record<'A' | 'B', number>; outs: Record<'A' | 'B', number>;
  target: number | null; batterId: string; bowlerId: string; batterStrikes: number;
  batterSubmitted: boolean; bowlerSubmitted: boolean; lastDelivery: Delivery | null; winner: 'A' | 'B' | 'tie' | null;
  notice: string;
};
type Room = { roomCode: string; hostPlayerId: string; mode: GameMode; phase: Phase; players: Player[]; notice: string; match: Match | null };
type Ack = { ok: boolean; roomCode?: string; playerId?: string; room?: Room; error?: string };
type ArenaStatus = { activeRooms: number; connectedPlayers: number; maxPlayersPerRoom: number; maxPlayersPerTeam: number; modes: GameMode[] };
type Socket = {
  connected: boolean;
  on: (event: string, listener: (...args: any[]) => void) => Socket;
  off: (event: string, listener: (...args: any[]) => void) => Socket;
  emit: (event: string, ...args: any[]) => Socket;
  disconnect: () => Socket;
};

const queryClient = new QueryClient();
const PLAYER_ID_KEY = 'hand-cricket-player-id';
const ROOM_CODE_KEY = 'hand-cricket-room-code';
const PLAYER_NAME_KEY = 'hand-cricket-player-name';
const getPlayerId = () => {
  let id = localStorage.getItem(PLAYER_ID_KEY);
  if (!id) {
    id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `player-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    localStorage.setItem(PLAYER_ID_KEY, id);
  }
  return id;
};

function useArenaQueries() {
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 15000, retry: 1 } });
  const status = useGetArenaStatus({ query: { queryKey: getGetArenaStatusQueryKey(), refetchInterval: 12000, retry: 1 } });
  return { health, status };
}

function useGameSocket(onRoom?: (room: Room) => void, onError?: (message: string) => void) {
  const socketRef = useRef<Socket | null>(null);
  const onRoomRef = useRef(onRoom);
  const onErrorRef = useRef(onError);
  onRoomRef.current = onRoom;
  onErrorRef.current = onError;
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(true);
  useEffect(() => {
    const socket = io({ path: '/socket.io', reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 700, reconnectionDelayMax: 5000 });
    socketRef.current = socket;
    const handleConnect = () => { setConnected(true); setConnecting(false); };
    const handleDisconnect = () => { setConnected(false); setConnecting(true); };
    const handleRoom = (room: Room) => onRoomRef.current?.(room);
    const handleError = (e: { message?: string } | string) => onErrorRef.current?.(typeof e === 'string' ? e : e?.message || 'Something went wrong. Try again.');
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', () => { setConnected(false); setConnecting(true); });
    socket.on('room:state', handleRoom);
    socket.on('room:error', handleError);
    setConnected(socket.connected);
    return () => { socket.off('connect', handleConnect); socket.off('disconnect', handleDisconnect); socket.off('room:state', handleRoom); socket.off('room:error', handleError); socket.disconnect(); socketRef.current = null; };
  }, []);
  const emit = useCallback(<T,>(event: string, payload?: unknown): Promise<T> => new Promise((resolve, reject) => {
    const socket = socketRef.current;
    if (!socket?.connected) { reject(new Error('Connection is still warming up. Try again in a moment.')); return; }
    socket.emit(event, payload, (ack: T) => resolve(ack));
  }), []);
  const send = useCallback((event: string, payload?: unknown) => {
    const socket = socketRef.current;
    if (socket?.connected) socket.emit(event, payload);
  }, []);
  return { connected, connecting, emit, send };
}

function Brand() {
  return <div className="flex items-center gap-3">
    <div className="grid h-10 w-10 place-items-center rounded-[14px] border border-emerald-300/35 bg-emerald-300/10 text-[#4ade80]">
      <Swords size={21} strokeWidth={2.3} />
    </div>
    <div className="leading-none"><div className="display-type text-[22px] font-extrabold tracking-[.04em] text-white">HAND CRICKET</div><div className="mono mt-1 text-[9px] tracking-[.24em] text-emerald-200/70">ARENA / LIVE</div></div>
  </div>;
}

function ConnectionPill({ connected, connecting }: { connected: boolean; connecting: boolean }) {
  return <div data-testid="status-connection" className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-bold ${connected ? 'border-emerald-300/25 bg-emerald-300/8 text-emerald-200' : 'border-amber-300/20 bg-amber-300/8 text-amber-100'}`}>
    {connected ? <><span className="live-dot h-1.5 w-1.5 rounded-full bg-[#4ade80]" />Connected</> : connecting ? <><LoaderCircle className="animate-spin" size={13} />Reconnecting</> : <><WifiOff size={13} />Offline</>}
  </div>;
}

function Home() {
  const [, setLocation] = useLocation();
  const { health, status } = useArenaQueries();
  const [playerName, setPlayerName] = useState(localStorage.getItem(PLAYER_NAME_KEY) || '');
  const [roomCode, setRoomCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const socket = useGameSocket(undefined, setError);
  const arena = status.data as ArenaStatus | undefined;
  const serviceOk = health.data?.status === 'ok' || health.isSuccess;
  const savedCode = localStorage.getItem(ROOM_CODE_KEY);
  const submit = async (event: Pick<FormEvent, 'preventDefault'>, action: 'create' | 'join' | 'resume') => {
    event.preventDefault();
    setError('');
    if (!playerName.trim()) { setError('Add your name before stepping onto the pitch.'); return; }
    if (!socket.connected) { setError('Connecting to the arena… try again in a second.'); return; }
    setBusy(true);
    const playerId = getPlayerId();
    const code = (action === 'resume' ? savedCode || '' : roomCode).trim().toUpperCase();
    try {
      const ack = await socket.emit<Ack>(action === 'create' ? 'room:create' : action === 'join' ? 'room:join' : 'room:resume',
        action === 'create' ? { playerName: playerName.trim(), playerId } :
          action === 'join' ? { roomCode: code, playerName: playerName.trim(), playerId } : { roomCode: code, playerId });
      if (!ack?.ok || !ack.roomCode) throw new Error(ack?.error || 'Could not enter that room.');
      localStorage.setItem(PLAYER_NAME_KEY, playerName.trim());
      localStorage.setItem(ROOM_CODE_KEY, ack.roomCode);
      setLocation(`/room/${encodeURIComponent(ack.roomCode)}`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not enter that room.'); }
    finally { setBusy(false); }
  };

  return <main className="arena-shell">
    <div className="arena-content mx-auto max-w-[1180px] px-5 pb-10 pt-6 sm:px-8 lg:px-10">
      <header className="flex items-center justify-between">
        <Brand />
        <ConnectionPill connected={socket.connected} connecting={socket.connecting} />
      </header>

      <section className="grid gap-8 pb-12 pt-12 md:grid-cols-[1fr_.82fr] md:items-center md:gap-14 md:pb-16 md:pt-16">
        <div className="entrance">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-300/15 bg-emerald-300/[.06] px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-[.16em] text-emerald-200">
            <Radio size={13} /> Private rooms. Real-time rivalry.
          </div>
          <h1 className="display-type max-w-[650px] text-[clamp(3.6rem,9vw,7.2rem)] font-black uppercase leading-[.83] tracking-[-.045em] text-white">
            Your crew.<br /><span className="text-[#4ade80]">Your crease.</span>
          </h1>
          <p className="mt-6 max-w-[470px] text-sm font-semibold leading-7 text-[#aab8c8] sm:text-base">
            Challenge your friends. Own the crease.
          </p>
          <p className="mt-2 max-w-[470px] text-sm leading-7 text-[#aab8c8] sm:text-base">
            Pick a number. Read your rival. Every delivery lands live, with the scoreboard to prove it.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs font-semibold text-slate-400">
            <div className="flex items-center gap-2"><ShieldCheck size={15} className="text-emerald-300" />Server-scored matches</div>
            <div className="flex items-center gap-2"><LockKeyhole size={14} className="text-emerald-300" />Invite-only rooms</div>
          </div>
        </div>

        <div className="relative entrance entrance-delay">
          <div className="pointer-events-none absolute -inset-5 rounded-[40px] bg-emerald-400/[.035] blur-2xl" />
          <section className="panel relative rounded-[26px] p-5 sm:p-7">
            <div className="mb-6 flex items-start justify-between gap-3">
              <div><p className="mono text-[10px] font-bold tracking-[.2em] text-emerald-200/65">MATCH NIGHT STARTS HERE</p><h2 className="display-type mt-1 text-[32px] font-extrabold leading-none text-[#4ade80] sm:text-[36px]">ENTER THE ARENA</h2></div>
              <div className="rounded-xl border border-emerald-300/15 bg-[#0b1b27] p-2.5 text-emerald-200"><Flag size={19} /></div>
            </div>
            <label htmlFor="playerName" className="mb-2 block text-xs font-bold text-slate-300">Your name</label>
            <input id="playerName" data-testid="input-player-name" value={playerName} onChange={e => setPlayerName(e.target.value)} maxLength={20} placeholder="What should your team call you?" className="field h-12 w-full rounded-xl px-4 text-sm" />
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button data-testid="button-create-room" disabled={!socket.connected || busy} onClick={e => void submit(e, 'create')} className="green-button flex h-12 items-center justify-center gap-2 rounded-xl px-4 text-sm">
                {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Sparkles size={16} />}Create a room
              </button>
              <form onSubmit={e => void submit(e, 'join')} className="flex h-12 min-w-0 overflow-hidden rounded-xl border border-slate-500/25 bg-[#091624] focus-within:border-emerald-300/70">
                <input aria-label="Room code" data-testid="input-room-code" value={roomCode} onChange={e => setRoomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))} placeholder="ROOM CODE" className="min-w-0 flex-1 bg-transparent px-3 text-[11px] font-extrabold tracking-[.12em] text-white outline-none placeholder:text-slate-600 sm:px-4 sm:text-xs" />
                <button data-testid="button-join-room" disabled={!socket.connected || busy || !roomCode.trim()} className="grid w-12 shrink-0 place-items-center text-emerald-300 transition hover:bg-emerald-300/10 disabled:opacity-30" aria-label="Join room"><ArrowRight size={18} /></button>
              </form>
            </div>
            {savedCode && <button data-testid="button-resume-room" disabled={!socket.connected || busy} onClick={e => void submit(e, 'resume')} className="ghost-button mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-xs font-bold"><ArrowRight size={14} />Resume room <span className="mono text-emerald-200">{savedCode}</span></button>}
            {error && <div data-testid="text-home-error" role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-rose-300/20 bg-rose-400/[.07] px-3 py-2.5 text-xs leading-5 text-rose-100"><CircleHelp size={15} className="mt-0.5 shrink-0 text-rose-300" />{error}</div>}
            {!socket.connected && <p className="mt-3 text-center text-[11px] text-slate-500">Arena connection required to create or join.</p>}
            <p className="mt-4 border-t border-slate-700/40 pt-4 text-center text-[11px] leading-5 text-slate-500">
              How to play: pick a team, share your room code, then choose numbers against the other side.
            </p>
          </section>
        </div>
      </section>

      <section className="entrance entrance-later">
        <div className="mb-3 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.2em] text-slate-500"><Activity size={13} className="text-emerald-300" />Arena pulse</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label="Players in play" value={status.isLoading ? '—' : arena?.connectedPlayers ?? '—'} foot="Across active rooms" loading={status.isLoading} />
          <StatTile label="Rooms on the board" value={status.isLoading ? '—' : arena?.activeRooms ?? '—'} foot="Private matches live" loading={status.isLoading} />
          <StatTile label="Service status" value={health.isLoading ? 'Checking' : serviceOk ? 'Ready' : 'Unavailable'} foot={health.isError ? 'Could not reach the match server' : 'Socket-powered, server-authoritative'} loading={health.isLoading} />
        </div>
      </section>
      <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-slate-700/40 pt-5 text-[10px] font-semibold uppercase tracking-[.14em] text-slate-600">
        <span>HAND CRICKET ARENA</span><span className="flex items-center gap-2"><span className={`h-1.5 w-1.5 rounded-full ${socket.connected ? 'bg-[#4ade80]' : 'bg-amber-300'}`} />{socket.connected ? 'Arena link active' : 'Waiting for arena link'}</span>
      </footer>
    </div>
  </main>;
}

function StatTile({ label, value, foot, loading }: { label: string; value: string | number; foot: string; loading?: boolean }) {
  return <div data-testid={`stat-${label.toLowerCase().replaceAll(' ', '-')}`} className="panel flex min-h-[102px] items-center justify-between rounded-2xl px-4 py-4 sm:px-5">
    <div><div className="text-[11px] font-bold text-slate-400">{label}</div><div className="mt-1 text-xs text-slate-600">{foot}</div></div>
    <div className="mono min-w-[62px] text-right text-2xl font-bold tracking-tight text-white">{loading ? <span className="inline-block h-6 w-12 animate-pulse rounded bg-slate-700/70" /> : value}</div>
  </div>;
}

function RoomPage() {
  const { code = '' } = useParams<{ code: string }>();
  const [, setLocation] = useLocation();
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [shareCopied, setShareCopied] = useState(false);
  const { health } = useArenaQueries();
  const socket = useGameSocket(setRoom, setError);
  const playerId = getPlayerId();
  const myPlayer = room?.players.find(player => player.id === playerId);
  const isHost = room?.hostPlayerId === playerId;
  const match = room?.match;
  const teamSize = (team: 'A' | 'B') => room?.players.filter(player => player.team === team).length || 0;
  const watchers = room?.players.filter(player => player.team === null) || [];
  const batter = room?.players.find(player => player.id === match?.batterId);
  const bowler = room?.players.find(player => player.id === match?.bowlerId);
  const isBatter = match?.batterId === playerId;
  const isBowler = match?.bowlerId === playerId;
  const ackAction = async (event: string, payload?: unknown, success?: string) => {
    setError('');
    if (!socket.connected) { setError('Reconnecting to the arena. Try again when the link is back.'); return; }
    socket.send(event, payload);
    if (success) { setNotice(success); window.setTimeout(() => setNotice(''), 2500); }
  };
  useEffect(() => {
    if (!socket.connected || !code) return;
    const savedCode = localStorage.getItem(ROOM_CODE_KEY);
    const playerName = localStorage.getItem(PLAYER_NAME_KEY) || '';
    const event = savedCode?.toUpperCase() === code.toUpperCase() ? 'room:resume' : 'room:join';
    socket.emit<Ack>(event, event === 'room:resume' ? { roomCode: code.toUpperCase(), playerId } : { roomCode: code.toUpperCase(), playerName, playerId })
      .then(ack => {
        if (!ack?.ok) { setError(ack?.error || 'This room is no longer available.'); return; }
        if (ack.room) setRoom(ack.room);
        localStorage.setItem(ROOM_CODE_KEY, ack.roomCode || code.toUpperCase());
        if (ack.playerId) localStorage.setItem(PLAYER_ID_KEY, ack.playerId);
      }).catch(e => setError(e instanceof Error ? e.message : 'Could not reconnect to room.'));
  }, [socket.connected, socket.emit, code, playerId]);
  const copyRoomCode = async () => {
    try { await navigator.clipboard.writeText(room?.roomCode || code.toUpperCase()); setShareCopied(true); window.setTimeout(() => setShareCopied(false), 1800); }
    catch { setError('Could not copy the room code. Select the code and copy it manually.'); }
  };
  const leave = async () => {
    try { await socket.emit('room:leave', { roomCode: room?.roomCode || code, playerId }); } catch { /* leave locally if the link has dropped */ }
    localStorage.removeItem(ROOM_CODE_KEY);
    setLocation('/');
  };
  const waitingForOther = !!match && (isBatter ? !match.bowlerSubmitted : isBowler ? !match.batterSubmitted : false);

  return <main className="arena-shell">
    <div className="arena-content mx-auto max-w-[1120px] px-4 pb-10 pt-5 sm:px-7 lg:px-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <button data-testid="button-back-home" onClick={() => setLocation('/')} className="ghost-button flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold"><ArrowLeft size={15} />Arena</button>
        <Brand />
        <ConnectionPill connected={socket.connected} connecting={socket.connecting} />
      </header>
      <div className="mt-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mono text-[10px] font-bold tracking-[.22em] text-emerald-200/60">PRIVATE MATCH ROOM</p>
          <h1 className="display-type mt-1 text-[36px] font-black uppercase leading-none text-[#4ade80] sm:text-[44px]">{room ? room.phase === 'lobby' ? 'Set the sides' : room.phase === 'playing' ? 'Match in play' : 'Final score' : 'Joining room'}</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-xl border border-slate-600/40 bg-[#0b1927] px-3 py-2.5"><div className="mono text-[9px] tracking-[.16em] text-slate-500">ROOM CODE</div><div data-testid="text-room-code" className="mono mt-1 text-sm font-bold tracking-[.18em] text-white">{room?.roomCode || code.toUpperCase()}</div></div>
          <button data-testid="button-copy-room-code" onClick={() => void copyRoomCode()} className="ghost-button grid h-[52px] w-[52px] place-items-center rounded-xl text-emerald-200" aria-label="Copy room code" title={shareCopied ? 'Room code copied' : 'Copy room code'}>{shareCopied ? <Check size={17} /> : <Copy size={17} />}</button>
          <button data-testid="button-leave-room" onClick={() => void leave()} className="ghost-button grid h-[52px] w-[44px] place-items-center rounded-xl text-slate-300" aria-label="Leave room"><DoorOpen size={17} /></button>
        </div>
      </div>
      {error && <div data-testid="text-room-error" role="alert" className="mt-4 flex items-start justify-between gap-3 rounded-xl border border-rose-300/20 bg-rose-400/[.07] px-4 py-3 text-sm text-rose-100"><span>{error}</span><button data-testid="button-dismiss-room-error" onClick={() => setError('')} aria-label="Dismiss error" className="text-rose-200"><X size={16} /></button></div>}
      {notice && <div data-testid="text-room-notice" className="mt-3 rounded-xl border border-emerald-300/20 bg-emerald-300/[.07] px-4 py-2.5 text-sm text-emerald-100">{notice}</div>}
      {room?.notice && <div data-testid="text-server-room-notice" className="mt-3 rounded-xl border border-slate-600/25 bg-[#0a1724] px-4 py-2.5 text-xs text-slate-300">{room.notice}</div>}
      {!room ? <div className="panel mt-6 flex min-h-[270px] flex-col items-center justify-center rounded-3xl p-8 text-center">
        <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-emerald-300/10 text-emerald-300">{socket.connected ? <LoaderCircle className="animate-spin" /> : <Wifi size={22} />}</div>
        <h2 className="display-type text-3xl font-extrabold text-white">{socket.connected ? 'Finding your room…' : 'Reconnecting to the arena'}</h2>
        <p className="mt-2 max-w-sm text-sm leading-6 text-slate-400">Your seat and match state are restored from the server as soon as the connection is back.</p>
        {health.isError && <p className="mt-4 text-xs text-amber-200">The match service is taking longer than usual.</p>}
      </div> : room.phase === 'lobby' ? <Lobby room={room} myPlayer={myPlayer} isHost={!!isHost} connected={socket.connected} maxPlayers={8} maxTeam={4} teamSize={teamSize} watchers={watchers} onAction={ackAction} />
      : <LiveMatch room={room} myPlayer={myPlayer} isHost={!!isHost} connected={socket.connected} batter={batter} bowler={bowler} watchers={watchers} waitingForOther={waitingForOther} onAction={ackAction} />}
    </div>
  </main>;
}

function Lobby({ room, myPlayer, isHost, connected, maxPlayers, maxTeam, teamSize, watchers, onAction }: {
  room: Room; myPlayer?: Player; isHost: boolean; connected: boolean; maxPlayers: number; maxTeam: number;
  teamSize: (team: 'A'|'B') => number; watchers: Player[]; onAction: (event: string, payload?: unknown, success?: string) => Promise<void>;
}) {
  const canStart = isHost && connected && room.players.some(p => p.team === 'A' && p.connected) && room.players.some(p => p.team === 'B' && p.connected);
  return <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_310px]">
    <section className="panel rounded-3xl p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="mono text-[10px] font-bold tracking-[.18em] text-slate-500">SQUAD SELECTION</p><h2 className="display-type mt-1 text-[32px] font-black leading-none text-[#4ade80] sm:text-[38px]">PICK YOUR SIDE</h2></div>
        <div className="rounded-full border border-slate-600/40 bg-[#0b1927] px-3 py-1.5 text-[11px] text-slate-400">{room.players.length}/{maxPlayers} players</div>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {(['A','B'] as const).map(team => {
          const selected = myPlayer?.team === team;
          const full = teamSize(team) >= maxTeam && !selected;
          return <button key={team} data-testid={`button-team-${team.toLowerCase()}`} disabled={!connected || full} onClick={() => void onAction('room:choose-team', { team }, `You’re on Team ${team}.`)}
            className={`rounded-2xl border-2 p-4 text-left transition sm:p-5 ${selected ? 'border-[#86efac] bg-[#4ade80] text-[#062315] shadow-[0_10px_30px_rgba(74,222,128,.12)]' : 'border-[#86efac]/75 bg-[#4ade80] text-[#062315] hover:-translate-y-0.5 hover:bg-[#86efac]'} disabled:cursor-not-allowed disabled:opacity-35`}>
            <div className="flex items-center justify-between"><div className="display-type text-[29px] font-black leading-none">TEAM {team} ({teamSize(team)}/{maxTeam})</div>{selected ? <Check size={19} strokeWidth={3} /> : <Users size={18} />}</div>
            <div className="mt-2 text-xs font-bold opacity-80">{teamSize(team)} / {maxTeam} players{full ? ' · full' : ''}</div>
            <div className="mt-4 flex flex-wrap gap-1.5">{room.players.filter(p => p.team === team).map(player => <span key={player.id} className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${selected ? 'bg-[#062315]/10' : 'bg-[#062315]/10'}`}>{player.name}{player.id === room.hostPlayerId ? ' · host' : ''}</span>)}{teamSize(team) === 0 && <span className="text-[11px] opacity-65">No players yet</span>}</div>
          </button>;
        })}
      </div>
      <div className="mt-7 border-t border-slate-700/50 pt-6">
        <div className="flex items-center justify-between gap-3"><div><div className="text-sm font-extrabold text-[#4ade80]">Match format</div><div className="mt-1 text-xs text-slate-500">Host chooses the rules for this room</div></div>{isHost && <span className="mono text-[9px] tracking-wider text-emerald-200/70">HOST CONTROL</span>}</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {(['normal','baseball'] as const).map(mode => <button key={mode} data-testid={`button-mode-${mode}`} disabled={!isHost || !connected} onClick={() => void onAction('room:set-mode', { mode }, `${mode === 'normal' ? 'Normal hand cricket' : 'Baseball mode'} selected.`)}
            className={`flex min-h-[68px] items-center justify-between rounded-2xl border-2 px-4 py-3 text-left transition disabled:opacity-35 ${room.mode === mode ? 'border-[#86efac] bg-[#4ade80] text-[#062315]' : 'border-[#86efac]/75 bg-[#4ade80] text-[#062315] hover:bg-[#86efac]'}`}>
            <span><span className="block text-sm font-black">{mode === 'normal' ? 'Normal Hand Cricket' : 'Baseball Mode'}</span><span className="mt-1 block text-[10px] font-bold opacity-70">{mode === 'normal' ? 'Classic run & wicket rules' : 'Fast innings, baseball strikes'}</span></span>
            {room.mode === mode ? <Check size={18} strokeWidth={3} /> : <span className="h-4 w-4 rounded-full border-2 border-[#062315]/35" />}
          </button>)}
        </div>
      </div>
    </section>
    <aside className="flex flex-col gap-4">
      <section className="panel rounded-3xl p-5">
        <div className="flex items-center justify-between"><div><p className="mono text-[9px] tracking-[.16em] text-slate-500">READY CHECK</p><h3 className="mt-1 text-sm font-extrabold text-[#4ade80]">Players on the pitch</h3></div><Users size={18} className="text-emerald-200" /></div>
        <div className="mt-4 space-y-2">
          {room.players.map(player => <div key={player.id} data-testid={`player-${player.id}`} className="flex items-center gap-3 rounded-xl bg-[#0a1724] px-3 py-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-full border border-slate-600/50 bg-slate-700/50 text-[10px] font-extrabold text-emerald-100">{player.name.slice(0,2).toUpperCase()}</div>
            <div className="min-w-0 flex-1"><div className="truncate text-xs font-bold text-slate-100">{player.name}{player.id === myPlayer?.id ? ' (you)' : ''}</div><div className="mt-0.5 text-[10px] text-slate-500">{player.team ? `Team ${player.team}` : 'Watching'}{player.id === room.hostPlayerId ? ' · Host' : ''}</div></div>
            <span className={`h-2 w-2 rounded-full ${player.connected ? 'bg-[#4ade80]' : 'bg-slate-600'}`} title={player.connected ? 'Connected' : 'Disconnected'} />
          </div>)}
          {room.players.length === 0 && <p className="text-xs text-slate-500">Waiting for players to arrive…</p>}
        </div>
        {watchers.length > 0 && <div className="mt-3 flex items-center gap-1.5 text-[10px] font-semibold text-slate-500"><Eye size={12} />{watchers.length} watching</div>}
      </section>
      <section className="panel rounded-3xl p-5">
        <div className="flex items-center gap-2 text-[#4ade80]"><Crown size={16} /><span className="text-xs font-extrabold">Room host</span></div>
        <p className="mt-2 text-xs leading-5 text-slate-400">{isHost ? 'You control the format and decide when the match begins.' : 'The host can choose a format and start once both sides are represented.'}</p>
        <button data-testid="button-start-match" disabled={!canStart} onClick={() => void onAction('room:start', undefined, 'Match started. Good luck!')} className="green-button mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm">
          <Swords size={16} />Start match
        </button>
        {!canStart && <p className="mt-2 text-center text-[10px] leading-4 text-slate-500">{!isHost ? 'Only the host can start.' : !connected ? 'Reconnect to start.' : 'Both teams need at least one connected player.'}</p>}
      </section>
    </aside>
  </div>;
}

function LiveMatch({ room, myPlayer, isHost, connected, batter, bowler, watchers, waitingForOther, onAction }: {
  room: Room; myPlayer?: Player; isHost: boolean; connected: boolean; batter?: Player; bowler?: Player; watchers: Player[]; waitingForOther: boolean;
  onAction: (event: string, payload?: unknown, success?: string) => Promise<void>;
}) {
  const match = room.match!;
  const [selectedBowler, setSelectedBowler] = useState('');
  const isAssigned = match.batterId === myPlayer?.id || match.bowlerId === myPlayer?.id;
  const canSubmit = connected && isAssigned && !(match.batterId === myPlayer?.id ? match.batterSubmitted : match.bowlerSubmitted);
  const canChangeBowler = connected && !!myPlayer?.team && myPlayer.team !== match.battingTeam && !match.batterSubmitted && !match.bowlerSubmitted;
  const battingScore = match.scores[match.battingTeam];
  const otherTeam = match.battingTeam === 'A' ? 'B' : 'A';
  const last = match.lastDelivery;
  const runs = last?.runs ?? 0;
  const score = (team: 'A'|'B') => `${match.scores[team]} / ${match.outs[team]}`;
  const bowlerOptions = room.players.filter(p => p.team && p.team !== match.battingTeam && p.connected && p.id !== match.bowlerId);
  const inningLabel = match.inning === 1 ? '1ST INNINGS' : '2ND INNINGS';
  const isWinner = room.phase === 'finished';
  return <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_300px]">
    <div className="space-y-4">
      <section className="panel overflow-hidden rounded-3xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/40 px-5 py-4 sm:px-7">
          <div><span className="mono text-[9px] font-bold tracking-[.18em] text-emerald-200/70">{room.mode === 'baseball' ? 'BASEBALL MODE' : 'NORMAL HAND CRICKET'} / {inningLabel}</span><div className="mt-1 text-xs font-semibold text-slate-400">Batting: <b className="text-white">Team {match.battingTeam}</b>{match.target !== null && <span> · Target <b className="text-emerald-200">{match.target}</b></span>}</div></div>
          <div className="flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/[.07] px-3 py-1.5 text-[10px] font-extrabold text-emerald-100"><span className="live-dot h-1.5 w-1.5 rounded-full bg-[#4ade80]" />{isWinner ? 'MATCH COMPLETE' : 'LIVE DELIVERY'}</div>
        </div>
        <div className="grid grid-cols-2 gap-3 p-4 sm:gap-4 sm:p-6">
          {(['A','B'] as const).map((team) => <div key={team} data-testid={`score-team-${team.toLowerCase()}`} className={`score-plate rounded-2xl border p-4 sm:p-5 ${match.battingTeam === team ? 'border-emerald-300/35' : 'border-slate-600/25'}`}>
            <div className="flex items-center justify-between"><span className="text-xs font-extrabold text-slate-300">TEAM {team}{match.battingTeam === team && <span className="ml-2 text-[8px] font-bold tracking-widest text-emerald-200">BATTING</span>}</span>{match.battingTeam === team && <Swords size={14} className="text-emerald-200" />}</div>
            <div className="mono mt-3 text-[clamp(1.8rem,7vw,2.8rem)] font-bold leading-none tracking-tight text-white">{score(team)}</div>
            <div className="mt-2 text-[10px] text-slate-500">Runs <b className="text-slate-300">{match.scores[team]}</b><span className="mx-2">·</span>Wickets <b className="text-slate-300">{match.outs[team]}</b></div>
          </div>)}
        </div>
        <div className="mx-4 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-600/20 bg-[#091624] px-4 py-3 sm:mx-6 sm:mb-6 sm:px-5">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Role label="BATTER" player={batter} active={isAssigned && match.batterId === myPlayer?.id} />
            <div className="h-7 w-px bg-slate-700/60" />
            <Role label="BOWLER" player={bowler} active={isAssigned && match.bowlerId === myPlayer?.id} />
          </div>
            <div className="text-right"><div className="mono text-[9px] tracking-[.12em] text-slate-600">{room.mode === 'baseball' ? `STRIKES ${match.batterStrikes}/3` : 'BATTER STRIKES'}</div><div className="mt-1 flex justify-end gap-1">{Array.from({ length: 3 }).map((_, i) => <span key={i} className={`h-2 w-2 rounded-sm ${i < match.batterStrikes ? 'bg-amber-300' : 'bg-slate-700'}`} />)}</div></div>
        </div>
      </section>

      {!isWinner && <section className="panel rounded-3xl p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="mono text-[9px] font-bold tracking-[.17em] text-slate-500">YOUR DELIVERY</p><h2 className="display-type mt-1 text-[30px] font-black leading-none text-[#4ade80] sm:text-[34px]">{isAssigned ? 'CHOOSE 1–6' : 'WATCH THE DUEL'}</h2></div>
          {isAssigned && <span className="rounded-full border border-emerald-300/20 bg-emerald-300/[.06] px-3 py-1.5 text-[10px] font-bold text-emerald-100">{match.batterId === myPlayer?.id ? 'You are batting' : 'You are bowling'}</span>}
        </div>
        {isAssigned ? <>
          <p className="mt-3 text-xs leading-5 text-slate-400">{canSubmit ? 'Commit your number. It stays hidden until your opponent has submitted too.' : waitingForOther ? 'Number locked in. Waiting for the other player — your choice stays hidden.' : 'Your number is in. Watch the server reveal the delivery.'}</p>
          <div className="mt-5 grid grid-cols-6 gap-2 sm:gap-3">
            {[1,2,3,4,5,6].map(n => <button key={n} data-testid={`button-number-${n}`} disabled={!canSubmit} onClick={() => void onAction('game:submit-number', { number: n }, 'Number submitted — held private until both players are ready.')}
              className="number-button grid aspect-square place-items-center rounded-xl border border-slate-600/35 bg-[#0a1724] text-xl font-black text-slate-100 disabled:opacity-40 sm:rounded-2xl sm:text-2xl">
              <span className="display-type">{n}</span>
            </button>)}
          </div>
          {!connected && <p className="mt-3 text-xs text-amber-200">Reconnecting… controls return when the arena link is restored.</p>}
        </> : <div className="mt-5 flex items-center gap-3 rounded-xl border border-slate-700/40 bg-[#0a1724] px-4 py-3 text-xs text-slate-400"><Eye size={16} className="shrink-0 text-emerald-200" />You’re watching this delivery. Numbers reveal only after both assigned players commit.</div>}
        {last && <div data-testid="panel-last-delivery" className="mt-5 rounded-2xl border border-emerald-300/20 bg-emerald-300/[.055] p-4 sm:p-5">
           <div className="flex flex-wrap items-center justify-between gap-2"><div className="mono text-[9px] font-bold tracking-[.18em] text-emerald-200/70">LAST DELIVERY</div><span className={`rounded-full px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-wider ${last.kind === 'out' || last.kind === 'strike-out' ? 'bg-rose-300/10 text-rose-200' : last.kind === 'strike' ? 'bg-amber-300/10 text-amber-100' : 'bg-emerald-300/10 text-emerald-100'}`}>{last.kind === 'strike' ? `STRIKE ${last.strikeCount}/3` : last.kind === 'strike-out' ? 'STRIKE 3/3 · WICKET' : last.kind === 'out' ? 'WICKET' : `${runs} RUN${runs === 1 ? '' : 'S'}`}</span></div>
          <div className="mt-3 flex items-center justify-center gap-5">
            <DeliveryValue label="BATTER" number={last.batterNumber} /><span className="text-slate-600">×</span><DeliveryValue label="BOWLER" number={last.bowlerNumber} />
          </div>
           <p className={`mt-3 text-center text-xs font-semibold ${last.kind === 'strike' || last.kind === 'strike-out' ? 'text-amber-100' : 'text-slate-300'}`}>{last.message}</p>
        </div>}
        {!isWinner && room.phase === 'playing' && <div className="mt-5 border-t border-slate-700/40 pt-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div><div className="text-xs font-extrabold text-slate-200">Change bowler</div><div className="mt-1 text-[10px] text-slate-500">A teammate from Team {otherTeam} takes the next ball.</div></div>
            <div className="flex min-w-0 gap-2">
              <select data-testid="select-change-bowler" value={selectedBowler} onChange={e => setSelectedBowler(e.target.value)} className="field min-w-0 flex-1 rounded-xl px-3 py-2 text-xs sm:w-[150px] sm:flex-none" disabled={!connected || bowlerOptions.length === 0}>
                <option value="">Choose bowler</option>{bowlerOptions.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}
              </select>
              <button data-testid="button-change-bowler" disabled={!canChangeBowler || !selectedBowler} onClick={() => void onAction('game:change-bowler', { bowlerId: selectedBowler }, 'Bowler updated.')} className="ghost-button rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-35">Change</button>
            </div>
          </div>
          {!canChangeBowler && <div className="mt-2 text-right text-[10px] text-slate-600">Available to players on the bowling team.</div>}
        </div>}
      </section>}
      {isWinner && <section className="panel rounded-3xl p-6 text-center sm:p-8">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-emerald-300/20 bg-emerald-300/10 text-emerald-200"><Crown size={25} /></div>
        <p className="mono mt-4 text-[10px] tracking-[.2em] text-emerald-200/65">FULL TIME</p>
         <h2 className="display-type mt-1 text-4xl font-black text-white sm:text-5xl">{match.winner === 'tie' ? 'MATCH TIED' : match.winner ? `TEAM ${match.winner} WINS` : 'MATCH COMPLETE'}</h2>
         <p className="mt-2 text-sm text-slate-400">{match.winner && match.winner !== 'tie' ? `Team ${match.winner} ${score(match.winner)}` : `Team A ${score('A')} · Team B ${score('B')}`} — a match for the group chat.</p>
        {isHost && <button data-testid="button-reset-match" disabled={!connected} onClick={() => void onAction('room:reset-match', undefined, 'Fresh match ready.')} className="green-button mt-6 inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm"><RotateCcw size={15} />Play again</button>}
        {!isHost && <p className="mt-5 text-xs text-slate-500">The host can reset the match for a rematch.</p>}
      </section>}
    </div>

    <aside className="flex flex-col gap-4">
      <section className="panel rounded-3xl p-5">
        <div className="flex items-center justify-between"><div><p className="mono text-[9px] tracking-[.16em] text-slate-500">ON THE SIDELINE</p><h3 className="mt-1 text-sm font-extrabold text-white">Room players</h3></div><Users size={18} className="text-emerald-200" /></div>
        <div className="mt-4 space-y-2">{room.players.map(p => <div key={p.id} className="flex items-center gap-3 rounded-xl bg-[#0a1724] px-3 py-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-full border border-slate-600/50 bg-slate-700/50 text-[10px] font-extrabold text-emerald-100">{p.name.slice(0,2).toUpperCase()}</div>
          <div className="min-w-0 flex-1"><div className="truncate text-xs font-bold text-slate-100">{p.name}{p.id === myPlayer?.id ? ' (you)' : ''}</div><div className="mt-0.5 text-[10px] text-slate-500">{p.id === match.batterId ? 'Batting' : p.id === match.bowlerId ? 'Bowling' : p.team ? `Team ${p.team}` : 'Watching'}</div></div>
          <span className={`h-2 w-2 rounded-full ${p.connected ? 'bg-[#4ade80]' : 'bg-slate-600'}`} />
        </div>)}</div>
        {watchers.length > 0 && <div className="mt-3 flex items-center gap-1.5 text-[10px] font-semibold text-slate-500"><Eye size={12} />{watchers.length} watching</div>}
      </section>
      <section className="panel rounded-3xl p-5">
        <div className="flex items-center gap-2 text-emerald-200"><CircleHelp size={16} /><span className="text-xs font-extrabold">Match notes</span></div>
        <div className="mt-3 space-y-3 text-[11px] leading-5 text-slate-400">
          <p>Both players choose in private. Numbers show only when the server resolves the delivery.</p>
          <p>{room.mode === 'baseball' ? 'Baseball mode tracks strikes; check the strike markers beside the active players.' : 'Match scoring, outs, innings and the target are controlled by the arena.'}</p>
          {match.target !== null && <p>Team {match.battingTeam} needs <b className="text-emerald-200">{Math.max(0, match.target - battingScore)} more</b> to win.</p>}
        </div>
      </section>
    </aside>
  </div>;
}

function Role({ label, player, active }: { label: string; player?: Player; active: boolean }) {
  return <div className="flex items-center gap-2.5"><div className="grid h-8 w-8 place-items-center rounded-full bg-slate-700/55 text-[9px] font-extrabold text-slate-200">{player?.name.slice(0,2).toUpperCase() || '—'}</div><div><div className="mono text-[8px] tracking-[.12em] text-slate-600">{label}{active ? ' · YOU' : ''}</div><div className="mt-0.5 max-w-[110px] truncate text-[11px] font-bold text-slate-200">{player?.name || 'Awaiting player'}</div></div></div>;
}

function DeliveryValue({ label, number }: { label: string; number: number }) {
  return <div className="text-center"><div className="mono text-[8px] tracking-[.16em] text-slate-500">{label}</div><div className="display-type mt-1 text-5xl font-black leading-none text-white">{number}</div></div>;
}

function Router() {
  return <RoutedErrorBoundary><Switch><Route path="/" component={Home} /><Route path="/room/:code" component={RoomPage} /><Route component={NotFound} /></Switch></RoutedErrorBoundary>;
}
function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}
export default App;
