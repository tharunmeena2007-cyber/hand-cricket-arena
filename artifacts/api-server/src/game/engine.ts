import { randomInt } from "node:crypto";

export type Team = "A" | "B";
export type GameMode = "normal" | "baseball";
export type RoomPhase = "lobby" | "playing" | "finished";
export type Winner = Team | "tie";

export interface PlayerRecord {
  id: string;
  name: string;
  team: Team | null;
  connected: boolean;
  socketId: string | null;
}

export interface DeliveryResult {
  number: number;
  batterId: string;
  bowlerId: string;
  batterName: string;
  bowlerName: string;
  batterNumber: number;
  bowlerNumber: number;
  kind: "run" | "out" | "strike" | "strike-out";
  runs: number;
  strikeCount: number;
  message: string;
}

interface MatchRecord {
  inning: 1 | 2;
  battingTeam: Team;
  scores: Record<Team, number>;
  dismissed: Record<Team, string[]>;
  target: number | null;
  batterId: string;
  bowlerId: string;
  batterStrikes: number;
  submissions: { batter?: number; bowler?: number };
  deliveryNumber: number;
  lastDelivery: DeliveryResult | null;
  winner: Winner | null;
  notice: string;
}

export interface RoomRecord {
  code: string;
  hostPlayerId: string;
  mode: GameMode;
  phase: RoomPhase;
  players: PlayerRecord[];
  match: MatchRecord | null;
  notice: string;
  cleanupTimeout: ReturnType<typeof setTimeout> | null;
}

export interface RoomSnapshot {
  roomCode: string;
  hostPlayerId: string;
  mode: GameMode;
  phase: RoomPhase;
  players: Array<Pick<PlayerRecord, "id" | "name" | "team" | "connected">>;
  notice: string;
  match: null | {
    inning: 1 | 2;
    battingTeam: Team;
    scores: Record<Team, number>;
    outs: Record<Team, number>;
    target: number | null;
    batterId: string;
    bowlerId: string;
    batterStrikes: number;
    batterSubmitted: boolean;
    bowlerSubmitted: boolean;
    deliveryNumber: number;
    lastDelivery: DeliveryResult | null;
    winner: Winner | null;
    notice: string;
  };
}

const rooms = new Map<string, RoomRecord>();
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_ROOM_PLAYERS = 8;
const MAX_TEAM_PLAYERS = 4;
const EMPTY_SCORES = (): Record<Team, number> => ({ A: 0, B: 0 });
const EMPTY_DISMISSED = (): Record<Team, string[]> => ({ A: [], B: [] });
const otherTeam = (team: Team): Team => (team === "A" ? "B" : "A");

function roomSnapshot(room: RoomRecord): RoomSnapshot {
  const match = room.match;
  return {
    roomCode: room.code,
    hostPlayerId: room.hostPlayerId,
    mode: room.mode,
    phase: room.phase,
    players: room.players.map(({ id, name, team, connected }) => ({
      id,
      name,
      team,
      connected,
    })),
    notice: room.notice,
    match: match
      ? {
          inning: match.inning,
          battingTeam: match.battingTeam,
          scores: { ...match.scores },
          outs: {
            A: match.dismissed.A.length,
            B: match.dismissed.B.length,
          },
          target: match.target,
          batterId: match.batterId,
          bowlerId: match.bowlerId,
          batterStrikes: match.batterStrikes,
          batterSubmitted: match.submissions.batter !== undefined,
          bowlerSubmitted: match.submissions.bowler !== undefined,
          deliveryNumber: match.deliveryNumber,
          lastDelivery: match.lastDelivery,
          winner: match.winner,
          notice: match.notice,
        }
      : null,
  };
}

export function getArenaStatus() {
  let connectedPlayers = 0;
  for (const room of rooms.values()) {
    connectedPlayers += room.players.filter((player) => player.connected).length;
  }
  return {
    activeRooms: rooms.size,
    connectedPlayers,
    maxPlayersPerRoom: MAX_ROOM_PLAYERS,
    maxPlayersPerTeam: MAX_TEAM_PLAYERS,
    modes: ["normal", "baseball"] as GameMode[],
  };
}

export function getRoom(code: string): RoomRecord | undefined {
  return rooms.get(code);
}

export function getRoomSnapshot(room: RoomRecord): RoomSnapshot {
  return roomSnapshot(room);
}

export function newRoomCode(): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = "";
    for (let index = 0; index < 6; index += 1) {
      code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
  throw new Error("Unable to allocate a unique room code");
}

export function createRoom(
  code: string,
  player: PlayerRecord,
): RoomRecord {
  const room: RoomRecord = {
    code,
    hostPlayerId: player.id,
    mode: "normal",
    phase: "lobby",
    players: [player],
    match: null,
    notice: "Choose a team, invite your friends, and get ready to play.",
    cleanupTimeout: null,
  };
  rooms.set(code, room);
  return room;
}

export function deleteRoom(code: string): void {
  const room = rooms.get(code);
  if (room?.cleanupTimeout) clearTimeout(room.cleanupTimeout);
  rooms.delete(code);
}

export function cleanPlayerName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (name.length < 2 || name.length > 18 || /[\u0000-\u001f\u007f]/u.test(name)) {
    return null;
  }
  return name;
}

export function isValidPlayerId(value: unknown): value is string {
  return typeof value === "string" && /^[\w-]{8,80}$/u.test(value);
}

export function setTeam(room: RoomRecord, player: PlayerRecord, team: Team): string | null {
  if (room.phase !== "lobby") return "Teams are locked once the match starts.";
  if (player.team === team) return null;
  const teamSize = room.players.filter((member) => member.team === team).length;
  if (teamSize >= MAX_TEAM_PLAYERS) return `Team ${team} is full.`;
  player.team = team;
  room.notice = `${player.name} joined Team ${team}.`;
  return null;
}

export function setGameMode(room: RoomRecord, mode: GameMode): string | null {
  if (room.phase !== "lobby") return "Game mode cannot change after the match begins.";
  room.mode = mode;
  room.notice = `${mode === "normal" ? "Normal Hand Cricket" : "Baseball Mode"} selected.`;
  return null;
}

function getPlayer(room: RoomRecord, playerId: string): PlayerRecord | undefined {
  return room.players.find((player) => player.id === playerId);
}

function firstPlayerOnTeam(
  room: RoomRecord,
  team: Team,
  excludedIds: string[] = [],
  connectedOnly = false,
): PlayerRecord | undefined {
  return room.players.find(
    (player) =>
      player.team === team &&
      !excludedIds.includes(player.id) &&
      (!connectedOnly || player.connected),
  );
}

function finishMatch(room: RoomRecord, winner: Winner, message: string): void {
  if (!room.match) return;
  room.phase = "finished";
  room.match.winner = winner;
  room.match.notice = message;
  room.match.submissions = {};
  room.notice = message;
}

export function startMatch(room: RoomRecord): string | null {
  if (room.phase !== "lobby") return "The match has already started.";
  const teamA = room.players.filter((player) => player.team === "A");
  const teamB = room.players.filter((player) => player.team === "B");
  if (!teamA.some((player) => player.connected) || !teamB.some((player) => player.connected)) {
    return "At least one connected player is needed on each team.";
  }
  if (teamA.length > MAX_TEAM_PLAYERS || teamB.length > MAX_TEAM_PLAYERS) {
    return "A team cannot have more than four players.";
  }

  const battingTeam: Team = randomInt(2) === 0 ? "A" : "B";
  const bowlingTeam = otherTeam(battingTeam);
  const batter = firstPlayerOnTeam(room, battingTeam, [], true);
  const bowler = firstPlayerOnTeam(room, bowlingTeam, [], true);
  if (!batter || !bowler) return "Both teams need a connected player to start.";

  room.phase = "playing";
  room.match = {
    inning: 1,
    battingTeam,
    scores: EMPTY_SCORES(),
    dismissed: EMPTY_DISMISSED(),
    target: null,
    batterId: batter.id,
    bowlerId: bowler.id,
    batterStrikes: 0,
    submissions: {},
    deliveryNumber: 0,
    lastDelivery: null,
    winner: null,
    notice: `Innings 1 — Team ${battingTeam} batting.`,
  };
  room.notice = "The match is live.";
  return null;
}

function nextBatter(room: RoomRecord, team: Team): PlayerRecord | undefined {
  const dismissed = room.match?.dismissed[team] ?? [];
  return firstPlayerOnTeam(room, team, dismissed);
}

function beginSecondInnings(room: RoomRecord): void {
  const match = room.match;
  if (!match) return;
  const oldBattingTeam = match.battingTeam;
  const battingTeam = otherTeam(oldBattingTeam);
  const batter = nextBatter(room, battingTeam);
  const bowler = firstPlayerOnTeam(room, oldBattingTeam);
  if (!batter || !bowler) {
    const teamA = room.players.some((player) => player.team === "A");
    const teamB = room.players.some((player) => player.team === "B");
    if (!teamA || !teamB) {
      finishMatch(room, teamA ? "A" : "B", "The opposing team has no players left.");
      return;
    }
    const winner = match.scores.A > match.scores.B
      ? "A"
      : match.scores.B > match.scores.A
        ? "B"
        : "tie";
    finishMatch(room, winner, "No eligible batter remains. Match complete.");
    return;
  }
  match.inning = 2;
  match.battingTeam = battingTeam;
  match.target = match.scores[oldBattingTeam] + 1;
  match.batterId = batter.id;
  match.bowlerId = bowler.id;
  match.batterStrikes = 0;
  match.submissions = {};
  match.notice = `Innings 2 — Team ${battingTeam} need ${match.target} to win.`;
  room.notice = match.notice;
}

function closeInnings(room: RoomRecord): void {
  const match = room.match;
  if (!match) return;
  if (match.inning === 1) {
    beginSecondInnings(room);
    return;
  }
  const winner: Winner =
    match.scores.A === match.scores.B
      ? "tie"
      : match.scores.A > match.scores.B
        ? "A"
        : "B";
  finishMatch(
    room,
    winner,
    winner === "tie" ? "The match is tied." : `Team ${winner} wins.`,
  );
}

function dismissCurrentBatter(
  room: RoomRecord,
  kind: "out" | "strike-out",
  message: string,
): void {
  const match = room.match;
  if (!match) return;
  const team = match.battingTeam;
  if (!match.dismissed[team].includes(match.batterId)) {
    match.dismissed[team].push(match.batterId);
  }
  const upcoming = nextBatter(room, team);
  match.submissions = {};
  if (!upcoming) {
    match.notice = `Team ${team} are all out.`;
    closeInnings(room);
    return;
  }
  match.batterId = upcoming.id;
  match.batterStrikes = 0;
  match.notice = message;
  const nextBowler = getPlayer(room, match.bowlerId);
  if (!nextBowler || nextBowler.team !== otherTeam(team)) {
    const replacement = firstPlayerOnTeam(room, otherTeam(team));
    if (replacement) match.bowlerId = replacement.id;
  }
}

function isBaseballStrike(batter: number, bowler: number): boolean {
  return (
    (batter === 5 && (bowler === 3 || bowler === 4)) ||
    (batter === 6 && (bowler === 1 || bowler === 5))
  );
}

export function setBowler(
  room: RoomRecord,
  actingPlayer: PlayerRecord,
  bowlerId: unknown,
): string | null {
  const match = room.match;
  if (room.phase !== "playing" || !match) return "There is no active match.";
  if (actingPlayer.team !== otherTeam(match.battingTeam)) {
    return "Only the bowling team can change its bowler.";
  }
  if (match.submissions.batter !== undefined || match.submissions.bowler !== undefined) {
    return "The delivery has started. Change the bowler before either number is submitted.";
  }
  if (typeof bowlerId !== "string") return "Choose a valid bowler.";
  const selected = getPlayer(room, bowlerId);
  if (!selected || selected.team !== otherTeam(match.battingTeam)) {
    return "The bowler must belong to the bowling team.";
  }
  if (!selected.connected) return "That player is not connected.";
  if (selected.id === match.bowlerId) return "That player is already bowling.";
  match.bowlerId = selected.id;
  match.notice = `${selected.name} is bowling this delivery.`;
  room.notice = match.notice;
  return null;
}

export function submitNumber(
  room: RoomRecord,
  player: PlayerRecord,
  number: unknown,
): string | null {
  const match = room.match;
  if (room.phase !== "playing" || !match) return "There is no active delivery.";
  if (!Number.isInteger(number) || typeof number !== "number" || number < 1 || number > 6) {
    return "Choose a number from 1 to 6.";
  }

  let role: "batter" | "bowler";
  if (player.id === match.batterId) role = "batter";
  else if (player.id === match.bowlerId) role = "bowler";
  else return "You are watching this delivery.";
  if (match.submissions[role] !== undefined) {
    return "You have already submitted for this delivery.";
  }
  match.submissions[role] = number;
  if (match.submissions.batter === undefined || match.submissions.bowler === undefined) {
    return null;
  }

  resolveDelivery(room);
  return null;
}

function resolveDelivery(room: RoomRecord): void {
  const match = room.match;
  if (!match) return;
  const batterNumber = match.submissions.batter;
  const bowlerNumber = match.submissions.bowler;
  if (batterNumber === undefined || bowlerNumber === undefined) return;

  const batter = getPlayer(room, match.batterId);
  const bowler = getPlayer(room, match.bowlerId);
  const batterName = batter?.name ?? "Batter";
  const bowlerName = bowler?.name ?? "Bowler";
  let kind: DeliveryResult["kind"] = "run";
  let runs = 0;
  let strikeCount = 0;
  let message = "";

  if (room.mode === "normal") {
    if (batterNumber === bowlerNumber) {
      kind = "out";
      message = `${batterName} is out — both players chose ${batterNumber}.`;
    } else {
      runs = batterNumber;
      match.scores[match.battingTeam] += runs;
      message = `${batterName} scores ${runs} run${runs === 1 ? "" : "s"}.`;
    }
  } else if (batterNumber === bowlerNumber) {
    runs = batterNumber * 2;
    match.scores[match.battingTeam] += runs;
    match.batterStrikes = 0;
    message = `Matching numbers — ${runs} runs!`;
  } else if (isBaseballStrike(batterNumber, bowlerNumber)) {
    match.batterStrikes += 1;
    strikeCount = match.batterStrikes;
    if (match.batterStrikes >= 3) {
      kind = "strike-out";
      message = "Strike 3/3 — batter is out.";
    } else {
      kind = "strike";
      message = `STRIKE — ${batterName} has ${match.batterStrikes}/3 consecutive strikes.`;
    }
  } else {
    runs = batterNumber;
    match.scores[match.battingTeam] += runs;
    match.batterStrikes = 0;
    message = `${batterName} scores ${runs} run${runs === 1 ? "" : "s"}.`;
  }

  match.deliveryNumber += 1;
  match.lastDelivery = {
    number: match.deliveryNumber,
    batterId: match.batterId,
    bowlerId: match.bowlerId,
    batterName,
    bowlerName,
    batterNumber,
    bowlerNumber,
    kind,
    runs,
    strikeCount,
    message,
  };
  match.submissions = {};
  room.notice = message;

  if (kind === "out" || kind === "strike-out") {
    dismissCurrentBatter(room, kind, message);
  } else if (match.inning === 2 && match.target !== null && match.scores[match.battingTeam] >= match.target) {
    const winner = match.battingTeam;
    finishMatch(room, winner, `Team ${winner} reached the target and wins!`);
  } else if (kind === "strike") {
    match.notice = `STRIKE ${strikeCount}/3`;
  } else {
    match.notice = message;
  }
}

export function updateMode(room: RoomRecord, mode: unknown): string | null {
  if (mode !== "normal" && mode !== "baseball") return "Choose a valid game mode.";
  return setGameMode(room, mode);
}

export function removePlayer(room: RoomRecord, player: PlayerRecord): void {
  const match = room.match;
  if (room.phase === "playing" && match) {
    if (player.id === match.batterId) {
      match.lastDelivery = {
        number: match.deliveryNumber + 1,
        batterId: player.id,
        bowlerId: match.bowlerId,
        batterName: player.name,
        bowlerName: getPlayer(room, match.bowlerId)?.name ?? "Bowler",
        batterNumber: 0,
        bowlerNumber: 0,
        kind: "out",
        runs: 0,
        strikeCount: match.batterStrikes,
        message: `${player.name} left the match and is out.`,
      };
      match.deliveryNumber += 1;
      match.submissions = {};
      dismissCurrentBatter(room, "out", `${player.name} left the match and is out.`);
    }
    if (room.phase === "playing" && player.id === match.bowlerId) {
      const replacement = firstPlayerOnTeam(room, otherTeam(match.battingTeam), [player.id]);
      if (replacement) {
        match.bowlerId = replacement.id;
        match.submissions = {};
      }
    }
  }
  room.players = room.players.filter((member) => member.id !== player.id);
  if (room.hostPlayerId === player.id) {
    room.hostPlayerId = room.players.find((member) => member.connected)?.id ?? room.players[0]?.id ?? "";
  }
  if (room.phase === "playing" && match) {
    const leftA = room.players.some((member) => member.team === "A");
    const leftB = room.players.some((member) => member.team === "B");
    if (!leftA || !leftB) finishMatch(room, leftA ? "A" : "B", "The opposing team has no players left.");
  }
  room.notice = `${player.name} left the room.`;
  if (room.players.length === 0) deleteRoom(room.code);
}
