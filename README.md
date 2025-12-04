# charla-realtime-communication
A real-time chat and voice call application built with Node.js, Express, MongoDB, WebRTC, and Socket.IO. Includes user authentication, message storage, call history, and live communication features.


# 🔧 Technical Architecture & Implementation Details

This project is a **full-stack real-time communication platform** built using modern web technologies. It supports **user authentication**, **private messaging**, **voice calling**, and **real-time updates** through WebSockets.

---

## 🧱 1. System Architecture Overview

The platform follows a **client–server architecture**:

### **Client (Frontend)**
- HTML, CSS, JavaScript  
- Communicates with backend via **REST API** (authentication, data fetching)  
- Uses **Socket.IO WebSockets** for real-time chat  
- Uses **WebRTC** for peer-to-peer audio communication  

### **Server (Backend – Node.js / Express.js)**
- Handles user registration & login  
- Stores messages and call logs  
- Manages all WebSocket events  
- Acts as the *signaling server* for WebRTC (exchange of offer/answer + ICE candidates)

### **Database (MongoDB)**
- Stores user accounts  
- Stores chat messages  
- Stores call logs  
- Uses ObjectId references to link relationships  

---

## 🧩 2. Technologies Used

| Feature | Technology |
|--------|------------|
| Backend Server | **Node.js + Express.js** |
| Real-Time Messaging | **Socket.IO** |
| Voice Calls (P2P Audio) | **WebRTC** |
| Database | **MongoDB** |
| Password Security | **bcrypt (hashing)** |
| SSL Certificates | **Self-signed (for WebRTC secure context)** |
| API Testing | **Postman** |
| Frontend | HTML, CSS, JavaScript |

---

## 📡 3. Real-Time Messaging (Socket.IO)

When a user sends a message:

1. Client emits `sendMessage`  
2. Server receives → saves in MongoDB  
3. Server emits `newMessage` to receiver in real-time  

This enables instant delivery and UI updates without refresh.

Each message document looks like:

```json
{
  "fromUser": "ObjectId",
  "toUser": "ObjectId",
  "content": "Hello!",
  "status": "sent",
  "createdAt": "timestamp"
}
```
Future support: delivered / seen / read receipts.

---

## 🎙️ 4. Voice Call System (WebRTC)

WebRTC enables **peer-to-peer audio communication** between two users with low latency and high quality.

### **WebRTC Call Flow**
1. Caller initiates a call and WebRTC generates an **offer**.  
2. The offer is sent to the backend using **Socket.IO**.  
3. Backend forwards the offer to the receiver (signaling).  
4. Receiver generates an **answer** and sends it back.  
5. Both sides exchange **ICE candidates**.  
6. Once negotiation finishes → a direct peer-to-peer audio stream is established.

**Important:**  
The server does **not** handle the audio stream. It only manages WebRTC signaling.

---

## 🛡️ 5. User Authentication

The platform uses **secure authentication** with hashed passwords stored in MongoDB.

User data structure:

```json
{
  "username": "example",
  "email": "example@gmail.com",
  "password": "hashed_password",
  "createdAt": "timestamp"
}
```
Security features:

1. Passwords are stored with bcrypt hashing
2. Login compares hashed values
3. Middleware protects private pages and routes


---
## 🗄️ 6. Database Structure

### **Users Collection**
Stores account information:
- Username  
- Email  
- Hashed password  
- Account creation timestamp  

### **Messages Collection**
Each message document contains:
- `fromUser` — sender’s ObjectId  
- `toUser` — receiver’s ObjectId  
- `content` — text message  
- `status` — sent / delivered  
- `createdAt` — timestamp  

### **Calls Collection**
Stores logs for voice calls:
- Caller ID  
- Receiver ID  
- Call start time  
- Call end time  
- Call status (completed / missed / rejected)


---
## ⚙️ 7. Backend Route Structure

The backend is organized into modular Express.js route files:

routes/
   auth.js        → Login / Register endpoints
   chat.js        → Message APIs
   call.js        → Call history APIs

models/
   User.js
   Message.js
   Call.js

middleware/
   auth.js        → Authentication and route protection


This structure improves readability, security, and maintainability.

---

## 🔐 8. HTTPS Requirement for WebRTC

WebRTC requires a **secure context** (HTTPS) to work in most browsers.

- The project uses **self-signed SSL certificates**  
- HTTPS is necessary for browsers to permit microphone access  
- Peer-to-peer audio will **not** establish without HTTPS  

This ensures safe, encrypted voice communication.

---

## 🚧 9. Known Limitations (Current Version)

- Message delivery/read receipts not implemented  
- Voice calls may experience echo or background noise  
- No group chat or group calling functionality  
- No message pagination (“load older messages”)  
- No typing indicators or online status  
- Basic frontend (not built with modern frameworks)  

These limitations are planned for future work.

---

## 🚀 10. Future Enhancements

- Add WebRTC echo cancellation & noise reduction  
- Implement message read receipts  
- Add typing indicators and user online/offline status  
- Introduce group chats and group voice calls  
- Build a full frontend interface using React or Vue  
- Implement JWT authentication for better security  
- Add Docker deployment (backend + MongoDB + frontend)  
- Improve overall UI/UX design  

These upgrades will significantly boost performance, usability, and scalability.

---




## Screenshots

### 1. Sign In Page
![Sign In Page](images/Sign_In.png)

### 2. Register Page
![Register Page](images/Register_Page.png)

### 3. Private Chat Screen
![Private Chat Screen](images/Private_Chat_Screen.jpg)

### 4. Calling Feature
![Calling Feature](images/Calling_Feature.jpg)

### 5. Users Collection (Database)
![Users Database](images/Users_DataBase.jpg)

### 6. Chats Collection (Database)
![Chats Database](images/Chats_DataBase.jpg)

### 7. Calls Collection (Database)
![Calls Database](images/Calls_DataBase.jpg)
