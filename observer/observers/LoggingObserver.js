export function LoggingObserver(eventBus) {
  eventBus.subscribe('error', err => console.error(err))
  eventBus.subscribe('processed', data => console.log('Done:', data))
}
