# **App Name**: ConnectISP

## Core Features:

- Agent Availability: Display a real-time list of support agents currently online, allowing for quick assignment of new chats.
- Contact Context: Show contextual information of a contact in the support panel.
- Smart Replies: An AI-powered tool automatically suggests canned responses based on the customer's message content, which agents can select.
- Chat Summarization: The AI tool summarizes long chat histories into key points to quickly get context, using generative AI.
- Chat Prioritization: Categorize conversation into atendimentos, gerais, e encerrados.
- Email notifications: Send notification emails when some event occurs.
- User Authentication: Implement a user authentication system to secure access to the support platform, using NextAuth.js
- External Chat Interface: Facilitate real-time communication between support agents and customers, mimicking the functionality of platforms like Chatwoot, with a design inspired by the provided HTML/CSS.
- Internal Chat System: Enable internal team communication through channels and direct messages, similar to Slack, integrated directly within the support platform.

## Style Guidelines:

- Primary color: #0056ff for main elements and gradients, providing a modern and trustworthy feel.
- Secondary color: #eef2f7 as the main background color, offering a clean and light interface.
- Accent color: Use variations of blue (#0056ff, #0045dd, #005eff, #0048e0) and white for active states, highlights, and interactive elements.
- Body and headline font: 'Inter', a sans-serif font, to ensure clear and modern readability across all text elements.
- Code font: 'Source Code Pro' for displaying code snippets within the application.
- Consistent use of Font Awesome icons to visually represent actions, categories, and statuses throughout the interface.
- Maintain a clean, structured layout using Tailwind CSS, focusing on responsive design for seamless use across devices. Utilize a sidebar menu, clear chat list, and well-defined panels for customer information and internal chat.
- Subtle animations for transitions and feedback, such as the fadeIn effect for new messages, pulse animations for typing indicators, and smooth transitions for panel overlays.