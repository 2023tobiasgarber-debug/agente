// Referencias a elementos del DOM
const chatZone = document.getElementById('zona-de-chat');
const chatForm = document.getElementById('chat-form');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');

// Constantes de control y seguridad
const TIMEOUT_LIMIT = 30000; // 30 segundos de límite para el AbortController
const COOLDOWN_MS = 1500;    // 1,5 segundos de pausa mínima entre envíos
const MAX_CHARS = 500;       // Límite máximo de caracteres por mensaje

let isProcessing = false;
let memorySessionId = null;

// Obtiene o crea el sessionId único de la sesión
function obtenerSessionId() {
    const STORAGE_KEY = 'promptin_session_id';

    try {
        const guardado = localStorage.getItem(STORAGE_KEY);
        if (guardado) return guardado;
    } catch (e) {
        // Si localStorage está bloqueado, seguimos con variable en memoria
    }

    if (memorySessionId) return memorySessionId;

    const nuevoId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : `ses_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

    memorySessionId = nuevoId;

    try {
        localStorage.setItem(STORAGE_KEY, nuevoId);
    } catch (e) {
        // Ignorar si no se puede guardar en localStorage
    }

    return nuevoId;
}

// Inicializamos el sessionId una sola vez al cargar la app
const sessionId = obtenerSessionId();

// Verifica si la URL del webhook está configurada correctamente
function esWebhookValido() {
    if (typeof WEBHOOK_URL !== 'string') return false;
    const url = WEBHOOK_URL.trim();
    if (!url || url.includes('ACA VA') || url.includes('ejemplo-webhook-prueba')) {
        return false;
    }
    return true;
}

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

    // Validación de límite de 500 caracteres en JavaScript
    if (messageText.length > MAX_CHARS) {
        appendMessage(`El mensaje no puede superar los ${MAX_CHARS} caracteres.`, 'bot', true);
        return;
    }

    // Validar que exista una URL válida antes de enviar
    if (!esWebhookValido()) {
        appendMessage("Falta pegar la URL de tu webhook en config.js", 'bot', true);
        return;
    }

    // Agregar el mensaje del usuario a la pantalla
    appendMessage(messageText, 'user');
    userInput.value = '';
    userInput.style.height = 'auto';

    // Deshabilitar interfaz mientras se procesa la respuesta
    setLoadingState(true);

    // Enviar consulta al Webhook de forma asíncrona
    await sendMessageToWebhook(messageText);
});

// Función para agregar burbujas de mensaje a la Zona de Chat usando textContent
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

// Limpia envoltorios de bloques de código Markdown (ej. ```json ... ```)
function limpiarEnvoltorioMarkdown(texto) {
    let limpio = texto.trim();
    if (limpio.startsWith('```')) {
        limpio = limpio.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '');
        limpio = limpio.replace(/\n?```\s*$/, '');
    }
    return limpio.trim();
}

// Extrae el primer campo válido en el orden requerido: response, respuesta, message, mensaje
function extraerCampoRespuesta(obj) {
    const claves = ['response', 'respuesta', 'message', 'mensaje'];
    for (const clave of claves) {
        if (Object.prototype.hasOwnProperty.call(obj, clave) && obj[clave] !== null && obj[clave] !== undefined) {
            const valor = String(obj[clave]).trim();
            if (valor.length > 0) {
                return valor;
            }
        }
    }
    return null;
}

// Analiza de forma tolerante el texto devuelto por Make
function procesarTextoMake(textoCrudo) {
    if (!textoCrudo) {
        return "(respuesta vacía)";
    }

    const textoLimpio = limpiarEnvoltorioMarkdown(textoCrudo);
    if (!textoLimpio) {
        return "(respuesta vacía)";
    }

    let parsed = null;
    let esJsonValido = false;

    // Primer intento de análisis JSON estándar
    try {
        parsed = JSON.parse(textoLimpio);
        esJsonValido = true;
    } catch (e) {
        // Si parece un objeto JSON con saltos de línea sin escapar, reintentamos
        if (textoLimpio.startsWith('{') && textoLimpio.endsWith('}')) {
            try {
                const escapado = textoLimpio.replace(/\r?\n/g, '\\n');
                parsed = JSON.parse(escapado);
                esJsonValido = true;
            } catch (e2) {
                // Respaldo con expresión regular si el JSON sigue roto
                const claves = ['response', 'respuesta', 'message', 'mensaje'];
                for (const clave of claves) {
                    const regex = new RegExp(`"${clave}"\\s*:\\s*"([\\s\\S]*?)"(?=\\s*[,}])`);
                    const match = textoLimpio.match(regex);
                    if (match && match[1].trim()) {
                        return match[1]
                            .replace(/\\n/g, '\n')
                            .replace(/\\r/g, '\r')
                            .replace(/\\"/g, '"')
                            .trim();
                    }
                }
            }
        }
    }

    // Si obtuvimos un JSON válido, verificamos si es un objeto real o un primitivo/lista
    if (esJsonValido) {
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const textoExtraido = extraerCampoRespuesta(parsed);
            return textoExtraido !== null ? textoExtraido : "Make respondió, pero sin el campo response";
        }
        // Si es número, booleano, null, lista o string entre comillas, devolvemos el texto tal cual
        return textoLimpio;
    }

    // Si es texto plano real (como "Accepted"), mostrarlo tal cual
    return textoLimpio;
}

// Envío con fetch, AbortController, manejo de estado y errores
async function sendMessageToWebhook(mensaje) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_LIMIT);

    // Indicador visual de "cargando"
    const loadingMessage = appendMessage("El consultor está respondiendo...", "bot");
    loadingMessage.querySelector('.bubble').classList.add('typing-indicator');

    try {
        const respuesta = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId,
                mensaje,
                fecha: new Date().toISOString()
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        const textoRespuesta = (await respuesta.text()).trim();
        loadingMessage.remove();

        if (!respuesta.ok) {
            appendMessage(
                `Make respondió con error (código ${respuesta.status}). Revisá que tu escenario esté en Active o que hayas apretado Run once.`,
                'bot',
                true
            );
            return;
        }

        const mensajeFinal = procesarTextoMake(textoRespuesta);
        appendMessage(mensajeFinal, 'bot');

    } catch (error) {
        clearTimeout(timeoutId);
        loadingMessage.remove();

        if (error.name === 'AbortError') {
            appendMessage("La solicitud tardó demasiado tiempo (más de 30 segundos). Por favor, intentá de nuevo.", "bot", true);
        } else {
            appendMessage("Error de red: no se pudo conectar con Make. Revisá tu conexión a internet.", "bot", true);
        }
    } finally {
        // Pausa mínima de 1,5 segundos entre envíos antes de rehabilitar controles
        setTimeout(() => {
            setLoadingState(false);
        }, COOLDOWN_MS);
    }
}

// Bloqueo y desbloqueo de controles
function setLoadingState(loading) {
    isProcessing = loading;
    sendBtn.disabled = loading;
    userInput.disabled = loading;
    if (!loading) userInput.focus();
}
