# 알려진 함정 / 반복 금지 (Known Issues)

> 버그·설계 함정·작업 실수를 발견하면 여기에 "증상 → 원인 → 재발 방지책"으로 남긴다.
> 게임 버그뿐 아니라 프로세스 실수(도구 오용, 커밋 누락 등)도 포함.
> 세션 시작 루틴에서 이 파일을 먼저 읽어 같은 실수를 예방한다.

## 템플릿
```
### <짧은 제목>
- 증상:
- 원인:
- 재발 방지책:
```

---

### GitHub Pages 첫 배포 시 configure-pages 권한 에러
- 증상: `actions/configure-pages@v5` 가 "Resource not accessible by integration" 로 실패,
  Pages 사이트 생성 안 됨.
- 원인: 워크플로 기본 `GITHUB_TOKEN` 권한으로는 Pages 사이트를 처음 만들지 못함.
- 재발 방지책: 레포 생성 직후 사용자 토큰으로 Pages 를 먼저 활성화한다 →
  `gh api --method POST repos/<owner>/<repo>/pages -f build_type=workflow`
  (Git Bash 는 leading slash 를 경로로 오인하니 슬래시 없이). 그 후 워크플로 재실행.
