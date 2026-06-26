// 실기(폰) 떨림 원인을 가르고 회전을 튜닝하기 위한 디버그 토글. URL 쿼리로 켠다.
//   ?norot      회전 고정(스프라이트가 회전하지 않음) → 떨림이 사라지면 회전이 원인.
//   ?nointerp   위치 보간 끔(sim 30/s 위치를 그대로 찍음) → 보간이 떨림에 주는 영향 확인.
//   ?showalpha  보간 비율(alpha)과 켜진 토글을 화면에 표시 → alpha 가 0~1 로 변하는지 확인.
//   ?dz=<라디안> 방향 데드존(이 각도 안의 방향 변화는 무시 = 방향 굳힘). 크면 덜 떨고 덜 돌아봄.
//   ?rotk=<0~1>  데드존을 넘는 진짜 회전의 이징 세기(60fps 1프레임 기준).
//   ?smooth=<0~1> 위치 평활 세기(작을수록 더 부드럽고 잔상↑). 1=평활 끔. 떨림이 거슬리면 낮춘다.
// 아무것도 안 붙이면 기본값으로 동작(평소 플레이엔 영향 없음). 렌더 전용이라 sim 결정론과 무관.

const search = typeof window !== "undefined" ? window.location.search : "";
const params = new URLSearchParams(search);

function num(name: string, fallback: number): number {
  const v = params.get(name);
  if (v === null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const DEBUG = {
  freezeRotation: params.has("norot"),
  noInterp: params.has("nointerp"),
  showAlpha: params.has("showalpha"),
} as const;

// 회전 떨림 튜닝(폰에서 URL 로 즉시 조절 → 한 번 배포로 여러 값을 시험).
export const TUNE = {
  headingDeadzone: num("dz", 0.32), // rad(~18°). 이 안의 방향 변화는 무시(방향 굳힘).
  rotEase: num("rotk", 0.2), // 데드존을 넘는 회전의 이징 세기.
  renderSmooth: num("smooth", 0.3), // 렌더 위치 평활(60fps 1프레임당). 작을수록 부드럽고 잔상↑. 1=끔.
} as const;

const tuned = params.has("dz") || params.has("rotk") || params.has("smooth");
export const DEBUG_ACTIVE: boolean =
  DEBUG.freezeRotation || DEBUG.noInterp || DEBUG.showAlpha || tuned;

/** 화면 디버그 배지에 보일 활성 토글/튜닝 요약(없으면 빈 문자열). */
export function debugLabel(): string {
  const on: string[] = [];
  if (DEBUG.freezeRotation) on.push("회전고정");
  if (DEBUG.noInterp) on.push("보간끔");
  if (DEBUG.showAlpha) on.push("alpha표시");
  if (params.has("dz")) on.push(`dz=${TUNE.headingDeadzone}`);
  if (params.has("rotk")) on.push(`rotk=${TUNE.rotEase}`);
  if (params.has("smooth")) on.push(`smooth=${TUNE.renderSmooth}`);
  return on.join(" · ");
}
