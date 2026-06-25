// 실기(폰) 떨림 원인을 가르기 위한 디버그 토글. URL 쿼리로 켠다(폰에서 주소 끝에 붙이기 쉽게).
//   ?norot      회전 고정(스프라이트가 회전하지 않음) → 떨림이 사라지면 회전이 원인.
//   ?nointerp   위치 보간 끔(sim 30/s 위치를 그대로 찍음) → 보간이 떨림에 주는 영향 확인.
//   ?showalpha  보간 비율(alpha)과 켜진 토글을 화면에 표시 → alpha 가 0~1 로 변하는지 확인.
// 아무것도 안 붙이면 전부 꺼짐(평소 플레이엔 영향 없음). 렌더 전용이라 sim 결정론과 무관.

const search = typeof window !== "undefined" ? window.location.search : "";
const params = new URLSearchParams(search);

export const DEBUG = {
  freezeRotation: params.has("norot"),
  noInterp: params.has("nointerp"),
  showAlpha: params.has("showalpha"),
} as const;

export const DEBUG_ACTIVE: boolean = DEBUG.freezeRotation || DEBUG.noInterp || DEBUG.showAlpha;

/** 화면 디버그 배지에 보일 활성 토글 요약(없으면 빈 문자열). */
export function debugLabel(): string {
  const on: string[] = [];
  if (DEBUG.freezeRotation) on.push("회전고정");
  if (DEBUG.noInterp) on.push("보간끔");
  if (DEBUG.showAlpha) on.push("alpha표시");
  return on.join(" · ");
}
