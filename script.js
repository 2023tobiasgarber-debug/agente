// Referencias a elementos del DOM
const chatZone = document.getElementById('zona-de-chat');
const chatForm = document.getElementById('chat-form');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');

// Control de peticiones y cooldown
let isProcessing = false;
const TIMEOUT_LIMIT = 10000; // 10 segundos de límite para el AbortController

// Ajuste automático de la altura del textarea
userInput.addEventListener('input', () => {
    userInput.style.height = 'auto';
    userInput.style.height = `${userInput.scrollHeight}px`;
});

// Listener para enviar mensaje mediante Formulario
chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const messageText = userInput.value.trim();

    if (!messageText || isProcessing) return;

    // Agregar el mensaje del usuario a la pantalla
    appendMessage(messageText, 'user');
    userInput.value = '';
    userInput.style.height = 'auto';

    // Deshabilitar interfaz mientras se procesa la respuesta
    setLoadingState(true);

    // Enviar consulta al Webhook de forma asíncrona
    await sendMessageToWebhook(messageText);
});

// Función para agregar burbujas de mensaje a la Zona de Chat
function appendMessage(text, sender, isError = false) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', `message-${sender}`);

    const bubbleDiv = document.createElement('div');
    bubbleDiv.classList.add('bubble');
    if (isError) bubbleDiv.classList.add('error-message');
    bubbleDiv.textContent = text;

    messageDiv.appendChild(bubbleDiv);
    chatZone.appendChild(messageDiv);
    
    // Desplazamiento automático al último mensaje
    chatZone.scrollTop = chatZone.scrollHeight;
    return messageDiv;
}

// Envío con fetch, AbortController, manejo de estado y errores
async function sendMessageToWebhook(message) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_LIMIT);

    // Indicador visual de "Pensando..."
    const loadingMessage = appendMessage("El consultor está respondiendo...", "bot");
    loadingMessage.querySelector('.bubble').classList.add('typing-indicator');

    try {
        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: message }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`Error en el servidor (${response.status})`);
        }

        const data = await response.json();
        // Eliminar mensaje de carga
        loadingMessage.remove();

        // Mostrar respuesta (Soporta propiedad 'response' o fallback a respuesta por defecto)
        const botReply = data.response || "Recibimos tu consulta correctamente sobre los trámites de manejo.";
        appendMessage(botReply, 'bot');

    } catch (error) {
        clearTimeout(timeoutId);
        loadingMessage.remove();

        if (error.name === 'AbortError') {
            appendMessage("La solicitud tardó demasiado tiempo. Por favor, intentá de nuevo.", "bot", true);
        } else {
            appendMessage("Ocurrió un inconveniente al conectar con el servidor de la escuela.", "bot", true);
        }
    } finally {
        // Enfriamiento breve para prevenir spam
        setTimeout(() => {
            setLoadingState(false);
        }, 1000);
    }
}

// Bloqueo y desbloqueo del botón de envío
function setLoadingState(loading) {
    isProcessing = loading;
    sendBtn.disabled = loading;
    userInput.disabled = loading;
    if (!loading) userInput.focus();
}
