# CloudRC — AI Coding Agent Memory

## Project Overview

CloudRC is a web-based RC car control platform. Users log in, join a queue to drive a physical RC car (HyperGo H12P), and control it via browser. A Spring Boot backend handles auth, session management, queue logic, WebSocket relay to ESP32, and STOMP messaging to browser.

**Stack:**
- Backend: Spring Boot 3.4.x, Java 21, Maven
- Database: H2 in-memory (dev), migrate to PostgreSQL for prod
- Auth: JWT (jjwt 0.11.5)
- WebSocket: STOMP (browser) + Raw WebSocket (ESP32)
- Hardware: ESP32 (car controller), Arduino Nano (signal analysis)
- Frontend: HTML/JS control page (React planned)

**Base package:** `com.cloudrc.server`
**Port:** 8000
**H2 Console:** `http://localhost:8000/h2-console` | URL: `jdbc:h2:mem:cloudrc` | user: `sa` | pass: (empty)

---

## Folder Structure

```
src/main/java/com/cloudrc/server/
├── ServerApplication.java        ← entry point, @EnableScheduling
├── config/
│   ├── AppConfig.java            ← @Bean definitions (BCrypt, TaskScheduler)
│   ├── SecurityConfig.java       ← Spring Security + JWT filter wiring
│   └── WebSocketConfig.java      ← STOMP + raw WebSocket config
├── controller/
│   ├── UserController.java       ← /api/auth/register, /api/auth/login
│   ├── CarController.java        ← /api/cars/**
│   └── BookingController.java    ← /api/bookings/**
├── service/
│   ├── UserService.java          ← register, login logic
│   ├── CarService.java           ← car CRUD, status updates
│   ├── BookingService.java       ← queue logic, session management
│   ├── JwtService.java           ← generate, validate, extract JWT
│   └── UserDetailsServiceImpl.java ← Spring Security user loading
├── repository/
│   ├── UserRepository.java
│   ├── CarRepository.java
│   └── BookingRepository.java
├── model/
│   ├── User.java                 ← implements UserDetails
│   ├── Car.java
│   └── Booking.java
├── dto/
│   ├── RegisterAndLoginRequestBody.java  ← { email, password }
│   ├── AuthResponse.java                 ← { id, email, role, createdAt }
│   ├── RegisterCarRequest.java           ← { name, carId }
│   ├── CreateBookingPayload.java         ← { carId }
│   └── CarCommandPayload.java            ← { t, s } float -1.0 to 1.0
├── enums/
│   ├── UserRoles.java            ← USER, ADMIN
│   ├── CarStatus.java            ← OFFLINE, IDLE, IN_USE
│   └── BookingStatus.java        ← QUEUED, ACTIVE, EXPIRED, CANCELLED
├── exception/
│   ├── GlobalExceptionHandler.java       ← @RestControllerAdvice
│   ├── ResourceNotFoundException.java    ← 404
│   ├── DuplicateResourceException.java   ← 409
│   └── InvalidCredentialsException.java  ← 401
├── filter/
│   └── JwtAuthFilter.java        ← validates JWT on every HTTP request
├── websocket/
│   ├── Esp32WsHandler.java       ← raw WebSocket handler for ESP32
│   ├── CarCommandController.java ← STOMP handler, relays browser → ESP32
│   └── StompAuthChannelInterceptor.java ← validates JWT on STOMP CONNECT
└── scheduler/
    └── SessionScheduler.java     ← safety net expiry check every 5min
```

---

## Models

### User
```java
Long id                    // auto-increment PK
String email               // unique, used for login
String password            // BCrypt hashed
UserRoles role             // USER | ADMIN
LocalDateTime createdAt    // auto set
// implements UserDetails — getUsername() returns email
```

### Car
```java
Long id                    // set manually (ESP32 UUID mapped to Long for now)
String name                // "H12P-01"
CarStatus status           // OFFLINE | IDLE | IN_USE — @Enumerated(STRING)
Integer batteryPct         // 0-100
LocalDateTime lastSeen     // last ESP32 heartbeat
```

### Booking
```java
Long id                    // auto-increment PK
User user                  // @ManyToOne FK → users.id
Car car                    // @ManyToOne FK → cars.id
BookingStatus bookingStatus // QUEUED|ACTIVE|EXPIRED|CANCELLED — @Enumerated(STRING)
Integer queuePosition      // null when ACTIVE, 1-based when QUEUED
LocalDateTime startTime    // null when QUEUED, set when ACTIVE
LocalDateTime endTime      // startTime + 30min, null when QUEUED
LocalDateTime createdAt    // auto set — used for queue ordering (FIFO)
```

---

## API Endpoints

### Auth — no JWT required
```
POST /api/auth/register
  body: { "email": "x@x.com", "password": "pass123" }
  returns: { id, email, role, createdAt }  HTTP 201

POST /api/auth/login
  body: { "email": "x@x.com", "password": "pass123" }
  returns: { "token": "eyJhbG..." }  HTTP 200
```

### Cars — no JWT required (dev), lock down in prod
```
POST /api/cars/register
  body: { "name": "H12P-01", "carId": "1" }
  returns: Car  HTTP 201

GET /api/cars
  returns: List<Car>  HTTP 200

GET /api/cars/{carId}
  returns: Car  HTTP 200
```

### Bookings — JWT required
```
POST /api/bookings
  header: Authorization: Bearer <token>
  body: { "carId": 1 }
  returns: Booking  HTTP 201
  — ACTIVE if car IDLE, QUEUED with position if car IN_USE

GET /api/bookings/my
  header: Authorization: Bearer <token>
  returns: Booking (ACTIVE or QUEUED)  HTTP 200

DELETE /api/bookings/{id}
  header: Authorization: Bearer <token>
  returns: { "message": "Booking cancelled successfully" }  HTTP 200
```

---

## WebSocket

### ESP32 Raw WebSocket
```
Connect:      ws://localhost:8000/esp32?carId=1
On connect:   car status → IDLE
On disconnect: car status → OFFLINE

ESP32 sends:  { "type": "telemetry", "battery": 87 }
Server sends: { "t": 0.50, "s": -0.30 }   ← control command
```

### Browser STOMP
```
Connect endpoint: http://localhost:8000/ws  (SockJS)
CONNECT headers:  { Authorization: "Bearer <token>" }

Send command:
  destination: /app/car/{carId}/control
  body: { "t": 0.5, "s": -0.3 }

Receive errors:
  subscribe: /user/queue/errors
  body: "No active booking" | "Not authorized for this car"

Future topics:
  /topic/car/{carId}/status    ← car state broadcast
  /topic/car/{carId}/queue     ← queue position updates
  /user/queue/session          ← session events (WARNING, EXPIRED)
```

---

## Key Business Logic

### Booking flow
```
POST /api/bookings
  1. validate user exists
  2. validate car exists + not OFFLINE
  3. check user has no existing ACTIVE or QUEUED booking
  4. if car IDLE → ACTIVE booking, startTime now, endTime now+30min, car→IN_USE
  5. if car IN_USE → QUEUED booking, queuePosition = count(QUEUED ahead) + 1
  6. if ACTIVE → schedule TaskScheduler task to fire at endTime
```

### Queue promotion (promoteNextInQueue)
```
1. find all QUEUED bookings for car ORDER BY createdAt ASC
2. if empty → car status = IDLE, done
3. promote queue.get(0) → ACTIVE, set startTime/endTime, schedule expiry
4. update queuePosition for remaining: index 1→pos1, 2→pos2...
5. car stays IN_USE
```

### Session expiry
```
TaskScheduler fires exactly at booking.endTime
→ booking status = EXPIRED
→ promoteNextInQueue()

Safety net: SessionScheduler runs every 5min
→ finds any ACTIVE bookings past endTime
→ expires them (catches missed tasks on restart)
```

### Grace period (TODO)
```
On WS disconnect:
  schedule 30s task → if fires → expire booking
On WS reconnect:
  cancel the scheduled task
```

### ETA calculation
```
ETA = remainingTimeOfActiveSession + (queuePosition - 1) * 30min
```

---

## Security Config — permitted paths
```
/h2-console/**   → permitAll
/api/auth/**     → permitAll
/api/cars/**     → permitAll (lock to ADMIN in prod)
/esp32/**        → permitAll (ESP32 connects here)
/ws/**           → permitAll (STOMP endpoint)
everything else  → authenticated (JWT required)
```

---

## ESP32 Hardware Notes
```
ESC PIN:       11 (Nano) / 18 (ESP32)
STEERING PIN:  10 (Nano) / 19 (ESP32)

ESC values (confirmed from signal analysis):
  ESC_MIN      = 1018 µs  (full reverse)
  ESC_NEUTRAL  = 1512 µs  (idle)
  ESC_DEADBAND = 1600 µs  (motor starts moving forward)
  ESC_MAX      = 2000 µs  (full forward)

Steering values:
  STEER_LEFT   = 1017 µs
  STEER_CENTER = 1502 µs
  STEER_RIGHT  = 2006 µs

Reverse protocol: brake-then-reverse (4 steps)
  1. send NEUTRAL (200ms)
  2. send reverse signal (200ms) — ESC brakes hard
  3. send NEUTRAL (100ms)
  4. send reverse signal again — motor runs

Battery: 2S LiPo (6.6V–8.4V)
  balance lead pins: GND | Cell1+ | Cell2+
  read via voltage divider → ESP32 ADC pin
  warn at 3.5V/cell, cutoff at 3.3V/cell
```

---

## JWT Flow
```
Login → JwtService.generateToken(user)
  payload: { sub: email, role: USER, iat, exp: +24h }
  signed with HS256 + base64 secret key

Every HTTP request:
  JwtAuthFilter.doFilterInternal()
  → extract "Bearer <token>" from Authorization header
  → jwtService.extractEmail(token)
  → userDetailsService.loadUserByUsername(email)
  → set UsernamePasswordAuthenticationToken in SecurityContextHolder

Every STOMP CONNECT:
  StompAuthChannelInterceptor.preSend()
  → extract token from STOMP Authorization header
  → same validation as HTTP filter
  → set user as Principal on STOMP session
  → available as Principal in @MessageMapping methods
```

---

## Repositories — key custom methods
```java
// UserRepository
Optional<User> findByEmail(String email)
boolean existsByEmail(String email)

// CarRepository
List<Car> findByStatus(CarStatus status)

// BookingRepository
Optional<Booking> findByUserAndBookingStatus(User user, BookingStatus status)
List<Booking> findByCarAndBookingStatusOrderByCreatedAtAsc(Car car, BookingStatus status)
List<Booking> findByBookingStatusAndEndTimeBefore(BookingStatus status, LocalDateTime time)
List<Booking> findByBookingStatus(BookingStatus status)
int countByCarAndBookingStatusAndCreatedAtBefore(Car car, BookingStatus status, LocalDateTime time)
```

---

## Common Errors & Fixes
```
403 on WebSocket    → add path to SecurityConfig permitAll
                      use setAllowedOriginPatterns("*") not setAllowedOrigins
H2 login fails      → JDBC URL must be jdbc:h2:mem:cloudrc (not default ~/test)
Enum stored as int  → missing @Enumerated(EnumType.STRING) on field
principal is null   → StompAuthChannelInterceptor not registered
                      or JWT not sent in STOMP CONNECT headers
BCrypt mismatch     → use .matches(raw, hashed) not .equals(hashed, encode(raw))
Bean not found      → missing @Bean in AppConfig or @Service/@Component on class
```

---

## TODO / Future
```
□ React frontend (replace HTML control page)
□ WebRTC signaling (camera stream from Android)
□ Grace period on disconnect (30s reconnect window)
□ Warning notification at 25min via STOMP
□ Battery telemetry parsing + DB update
□ Admin endpoints (manage cars, kick users, view queue)
□ Migrate H2 → PostgreSQL
□ Lock /api/cars/register to ADMIN role
□ Rate limiting on control commands
□ Multiple car support (already designed for it)
```