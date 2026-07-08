import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { insertRawEvents } from './db';

interface WatcherEvent {
  app: string;
  title: string;
  duration: number;
  started: string;
  ongoing?: boolean;
}

interface WatcherStatus {
  backend: string;
  permissions: string;
  running: boolean;
}

let watcherProcess: ChildProcess | null = null;
let watcherBackend: string = 'none';
let isWatcherRunning = false;
let eventBuffer: WatcherEvent[] = [];
let flushInterval: ReturnType<typeof setInterval> | null = null;
let onStatusChange: ((status: WatcherStatus) => void) | null = null;

export function setStatusCallback(cb: (status: WatcherStatus) => void): void {
  onStatusChange = cb;
}

function emitStatus(): void {
  if (onStatusChange) {
    onStatusChange({
      backend: watcherBackend,
      permissions: watcherBackend === 'CGWindow' ? 'none_required' : 'unknown',
      running: isWatcherRunning,
    });
  }
}

export function getWatcherStatus(): WatcherStatus {
  return {
    backend: watcherBackend,
    permissions: watcherBackend === 'CGWindow' ? 'none_required' : 'unknown',
    running: isWatcherRunning,
  };
}

async function flushBuffer(): Promise<number> {
  if (eventBuffer.length === 0) return 0;

  const batch = eventBuffer.splice(0);
  const rawEvents = batch.map(evt => ({
    source: 'native' as const,
    bucket_id: `watcher-${watcherBackend.toLowerCase()}`,
    timestamp: evt.started,
    duration: evt.duration,
    app: evt.app,
    title: evt.title,
    url: '',
    raw_data: JSON.stringify({ ongoing: evt.ongoing }),
  }));

  try {
    return insertRawEvents(rawEvents);
  } catch {
    return 0;
  }
}

function startFlushTimer(): void {
  if (flushInterval) return;
  flushInterval = setInterval(() => {
    flushBuffer().catch(() => {});
  }, 15000);
}

function stopFlushTimer(): void {
  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
  }
}

export async function startNativeWatcher(): Promise<{ ok: boolean; backend: string; error?: string }> {
  if (isWatcherRunning) {
    return { ok: true, backend: watcherBackend };
  }

  const pythonPath = findPython();
  if (pythonPath) {
    return startPythonWatcher(pythonPath);
  }

  return { ok: false, backend: 'none', error: 'Python 3 not found. Install with: brew install python3, then: pip3 install pyobjc-framework-Quartz' };
}

function findPython(): string | null {
  const candidates = ['python3', 'python'];
  const { execSync } = require('child_process');
  for (const cmd of candidates) {
    try {
      const result = execSync(`which ${cmd} 2>/dev/null || echo ""`, { encoding: 'utf-8' }).trim();
      if (result && result.length > 0) {
        return result;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function startPythonWatcher(pythonPath: string): { ok: boolean; backend: string; error?: string } {
  const scriptPath = path.join(__dirname, '..', 'watcher.py');

  try {
    watcherProcess = spawn(pythonPath, [scriptPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    let buffer = '';

    watcherProcess.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.status === 'started') {
            watcherBackend = parsed.backend || 'python';
            isWatcherRunning = true;
            startFlushTimer();
            emitStatus();
            console.error(`[daybrain] Native watcher started (${watcherBackend}, zero permissions)`);
          } else if (parsed.error === 'pyobjc_missing') {
            console.error(`[daybrain] ${parsed.message}`);
            stopNativeWatcher();
          } else if (parsed.error) {
            console.error(`[daybrain] Watcher error: ${parsed.error}`);
          } else if (parsed.app) {
            eventBuffer.push(parsed as WatcherEvent);
          }
        } catch {
          // skip non-JSON lines
        }
      }
    });

    watcherProcess.stderr?.on('data', (data: Buffer) => {
      console.error(`[daybrain] Watcher stderr: ${data.toString().trim()}`);
    });

    watcherProcess.on('close', (code) => {
      console.error(`[daybrain] Native watcher exited (code ${code})`);
      isWatcherRunning = false;
      stopFlushTimer();
      flushBuffer().catch(() => {});
      emitStatus();
      watcherProcess = null;
    });

    watcherProcess.on('error', (err) => {
      console.error(`[daybrain] Native watcher spawn error: ${err.message}`);
      isWatcherRunning = false;
      emitStatus();
      watcherProcess = null;
    });

    return { ok: true, backend: 'python' };
  } catch (err) {
    return { ok: false, backend: 'python', error: String(err) };
  }
}

export function stopNativeWatcher(): void {
  stopFlushTimer();
  flushBuffer().catch(() => {});

  if (watcherProcess) {
    watcherProcess.kill('SIGTERM');
    watcherProcess = null;
  }

  isWatcherRunning = false;
  watcherBackend = 'none';
  emitStatus();
  console.error('[daybrain] Native watcher stopped');
}
