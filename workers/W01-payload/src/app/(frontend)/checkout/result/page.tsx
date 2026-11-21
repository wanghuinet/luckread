export default function CheckoutResultPage() {
  return (
    <main>
      <h1>支付流程已返回</h1>
      <p>
        服务器尚需核验支付结果。浏览器跳转或支付 SDK 回调本身不代表已扣款成功，
        也不会在此页面直接开通会员权益。请勿在状态尚未核验时重复付款。
      </p>
    </main>
  )
}
