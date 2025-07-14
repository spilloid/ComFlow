export function RTPStreamObserver(eventBus, socket) {
  eventBus.subscribe('processed', ({ response }) => {
    // push response back onto RTP socket
    socket.send(/* ... */)
  })
}
