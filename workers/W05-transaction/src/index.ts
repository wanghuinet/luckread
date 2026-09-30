export default {
  async fetch(): Promise<Response> {
    return Response.json({
      worker: 'luckread-w05',
      status: 'ok',
    })
  },
}
