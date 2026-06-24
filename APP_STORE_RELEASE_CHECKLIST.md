# 우리동네 벌레예보 앱스토어 출시 체크리스트

## 1. 현재 완료

- Capacitor 네이티브 패키징 설정 추가
- iOS 프로젝트 생성: `ios/`
- Android 프로젝트 생성: `android/`
- 앱 ID 임시 설정: `com.yeolstudio.neighborhoodbugforecast`
- 앱 이름 설정: `우리동네 벌레예보`
- 위치 권한 플러그인 추가: `@capacitor/geolocation`
- iOS 위치 권한 문구 추가
- Android 위치 권한 선언 추가
- PWA manifest 및 기본 아이콘 추가

## 2. 출시 전 필수 준비

- Apple Developer Program 가입
- Google Play Console 개발자 계정 가입
- 실제 Bundle ID / Package Name 확정
- 앱 아이콘 1024px 및 Android adaptive icon 제작
- 앱스토어 스크린샷 제작
- 개인정보처리방침 URL 준비
- 위치정보 이용 목적 문구 확정
- Google 로그인 Firebase Auth 연결
- 시민관측 Firestore 저장 연결
- 동 단위 위치 판정용 reverse geocoding API 연결
- 실제 날씨 API 연결

## 3. iOS 제출 흐름

1. `npm run build`
2. `npx cap sync ios`
3. `npx cap open ios`
4. Xcode에서 Team, Signing, Bundle Identifier 설정
5. 실제 기기 또는 시뮬레이터 테스트
6. Archive 생성
7. App Store Connect 업로드
8. App Privacy 정보 입력
9. 심사 제출

## 4. Android 제출 흐름

1. Java Runtime 및 Android Studio 설치
2. `npm run build`
3. `npx cap sync android`
4. `npx cap open android`
5. Android Studio에서 앱 서명 키 설정
6. AAB 릴리즈 빌드 생성
7. Google Play Console 업로드
8. Data Safety 및 개인정보처리방침 입력
9. 비공개 테스트 후 프로덕션 출시

## 5. 지금 남은 기술 리스크

- 현재 시민관측 로그인은 프로토타입 상태이며 실제 Google OAuth가 아님
- 현재 제보 데이터는 로컬 상태이며 서버 DB에 저장되지 않음
- 현재 동 단위 자동 판정은 API 미연결 상태
- 예보 점수는 샘플 산식이므로 실데이터 기반 보정 필요
