const { createHttpError } = require('./httpError');

class BoundedSemaphore {
  constructor({ concurrency = 1, maxQueueLength = 5, queueTimeoutMs = 30000 }) {
    this.concurrency = concurrency;
    this.maxQueueLength = maxQueueLength;
    this.queueTimeoutMs = queueTimeoutMs;
    this.active = 0;
    this.queue = [];
    this.closed = false;
  }

  stats() {
    return {
      concurrency: this.concurrency,
      active: this.active,
      queued: this.queue.length,
      closed: this.closed,
    };
  }

  close() {
    this.closed = true;
    const waiting = this.queue.splice(0);
    for (const entry of waiting) {
      clearTimeout(entry.timer);
      entry.cleanupAbort();
      entry.reject(createHttpError(503, 'Archive service is shutting down.', 'SERVICE_SHUTTING_DOWN'));
    }
  }

  acquire({ signal } = {}) {
    if (this.closed) {
      return Promise.reject(createHttpError(503, 'Archive service is shutting down.', 'SERVICE_SHUTTING_DOWN'));
    }

    if (signal && signal.aborted) {
      return Promise.reject(createHttpError(499, 'Archive request was cancelled.', 'REQUEST_CANCELLED'));
    }

    if (this.active < this.concurrency) {
      this.active += 1;
      return Promise.resolve(this.createRelease());
    }

    if (this.queue.length >= this.maxQueueLength) {
      return Promise.reject(createHttpError(429, 'Archive queue is full.', 'ZIP_QUEUE_FULL'));
    }

    return new Promise((resolve, reject) => {
      const entry = {
        resolve,
        reject,
        timer: null,
        cleanupAbort: () => undefined,
      };

      const remove = () => {
        const index = this.queue.indexOf(entry);
        if (index >= 0) this.queue.splice(index, 1);
      };

      entry.timer = setTimeout(() => {
        remove();
        entry.cleanupAbort();
        reject(createHttpError(429, 'Archive queue wait timed out.', 'ZIP_QUEUE_TIMEOUT'));
      }, this.queueTimeoutMs);

      if (signal) {
        const onAbort = () => {
          clearTimeout(entry.timer);
          remove();
          reject(createHttpError(499, 'Archive request was cancelled.', 'REQUEST_CANCELLED'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        entry.cleanupAbort = () => signal.removeEventListener('abort', onAbort);
      }

      this.queue.push(entry);
    });
  }

  createRelease() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active = Math.max(0, this.active - 1);
      this.dispatch();
    };
  }

  dispatch() {
    if (this.closed) return;
    while (this.active < this.concurrency && this.queue.length > 0) {
      const entry = this.queue.shift();
      clearTimeout(entry.timer);
      entry.cleanupAbort();
      this.active += 1;
      entry.resolve(this.createRelease());
    }
  }
}

module.exports = { BoundedSemaphore };
