/**
 * Bridges the in-process EventEmitter event bus to Socket.io clients.
 * Getter functions are called on new connections to send an immediate state snapshot
 * so reconnecting clients hydrate correctly.
 */
function attachSocketBridge(io, eventBus, getSessionState, getRestreamStatus, getCaptureStatus, getSessionStats, getLiveViewers) {
  // Send current state snapshot to each newly connecting client
  io.on('connection', (socket) => {
    socket.emit('ottery:session', { state: getSessionState() });

    const restreamStatuses = getRestreamStatus();
    for (const status of Object.values(restreamStatuses)) {
      socket.emit('ottery:status', status);
    }

    if (getCaptureStatus) {
      const captureStatuses = getCaptureStatus();
      for (const status of Object.values(captureStatuses)) {
        socket.emit('ottery:status', { ...status, type: 'capture' });
      }
    }

    if (getSessionStats) {
      socket.emit('ottery:stats', { ...getSessionStats() });
    }

    if (getLiveViewers) {
      socket.emit('ottery:viewers', { ...getLiveViewers() });
    }
  });

  eventBus.on('event',            (e) => io.emit('ottery:event', e));
  eventBus.on('restream.started', (d) => io.emit('ottery:status', d));
  eventBus.on('restream.stopped', (d) => io.emit('ottery:status', d));
  eventBus.on('restream.error',   (d) => io.emit('ottery:status', d));
  eventBus.on('session.started',  (d) => io.emit('ottery:session', { state: 'live',  sessionId: d?.sessionId ?? null }));
  eventBus.on('session.ended',    (d) => io.emit('ottery:session', { state: 'ended', sessionId: d?.sessionId ?? null }));

  // Event capture status events
  eventBus.on('capture.started',    (d) => io.emit('ottery:status', { ...d, type: 'capture' }));
  eventBus.on('capture.stopped',    (d) => io.emit('ottery:status', { ...d, type: 'capture' }));
  eventBus.on('capture.error',      (d) => io.emit('ottery:status', { ...d, type: 'capture' }));
  eventBus.on('capture.connecting', (d) => io.emit('ottery:status', { ...d, type: 'capture' }));

  // Relay events — forwarded to Angular so it can show badges / fallback toasts
  eventBus.on('relay.streamReceived', (d) => io.emit('ottery:relay', { event: 'streamReceived', ...d }));
  eventBus.on('relay.fallback',       (d) => io.emit('ottery:relay', { event: 'fallback', ...d }));

  // Auth events
  eventBus.on('auth.required', (d) => io.emit('ottery:auth', d));

  // Credit balance updates
  eventBus.on('credits.updated', (d) => io.emit('ottery:credits', d));

  // Music events
  eventBus.on('music.connected',      (d) => io.emit('music.connected', d));
  eventBus.on('music.disconnected',   (d) => io.emit('music.disconnected', d));
  eventBus.on('music.queue_updated',  (d) => io.emit('music.queue_updated', d));
  eventBus.on('music.track_changed',  (d) => io.emit('music.track_changed', d));
  eventBus.on('music.playback_state', (d) => io.emit('music.playback_state', d));
}

module.exports = { attachSocketBridge };
