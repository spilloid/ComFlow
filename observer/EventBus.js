export class EventBus {
  constructor() { this.subscribers = {} }
  subscribe(event, fn) {
    (this.subscribers[event] ||= []).push(fn)
  }
  publish(event, data) {
    (this.subscribers[event] || []).forEach(fn => fn(data))
  }
}
