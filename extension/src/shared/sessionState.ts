export interface TaskContext {
  projectKey: string;
  taskKey: string;
  branchPath: string;
}

interface SessionStateData {
  signedIn: boolean;
  currentTask: TaskContext | null;
}

const state: SessionStateData = { signedIn: false, currentTask: null };

type SessionStateListener = (state: Readonly<SessionStateData>) => void;
let listener: SessionStateListener | null = null;

/** Only one subscriber is expected (activateAuthoring wiring session-file writes). */
export function onSessionStateChange(fn: SessionStateListener): void {
  listener = fn;
}

function emit(): void {
  listener?.({ ...state });
}

export function setSignedIn(signedIn: boolean): void {
  state.signedIn = signedIn;
  emit();
}

export function setCurrentTask(task: TaskContext | null): void {
  state.currentTask = task;
  emit();
}

export function getSessionState(): Readonly<SessionStateData> {
  return { ...state };
}
