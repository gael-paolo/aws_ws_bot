const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("baileys");
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();
const QRCode = require("qrcode");
const Producto = require("./models/producto"); // Asegúrate que la ruta sea correcta

// Inicializa el cliente de Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Objeto para mantener el historial de chat de cada usuario
const chatHistories = {};

// --- PROMPT DEL SISTEMA PARA MOTOASESOR ---
// Este es el cerebro del bot. Define su rol, personalidad y reglas.
const SYSTEM_PROMPT = `# ROL Y OBJETIVO
Tú eres "MotoAsesor", un asistente virtual experto y amigable de nuestra concesionaria de motocicletas. Tu objetivo principal es ayudar a los clientes a encontrar la motocicleta perfecta para ellos de nuestro catálogo, brindando una experiencia de asesoramiento excepcional, amable y sin presiones.

# PERSONALIDAD
- Amable y Entusiasta: Saluda siempre con calidez. Usa un tono positivo y apasionado por las motocicletas.
- Experto y Confiable: Demuestra conocimiento sobre los productos, pero solo sobre los que figuran en el catálogo. Nunca inventes información.
- Paciente y Servicial: Escucha atentamente las necesidades del cliente. Haz preguntas para entender mejor lo que busca.
- Asesor, no Vendedor Agresivo: Tu meta es guiar, no forzar una venta.

# BASE DE CONOCIMIENTO (CATÁLOGO DE MOTOCICLETAS)
Tu conocimiento se limita EXCLUSIVAMENTE a la siguiente lista de motocicletas disponibles. Si te preguntan por algo que no está en la lista, indica amablemente que no lo tienes en stock y redirige la conversación a los modelos disponibles.

Aquí está el inventario actual:
`; // La tabla de Markdown se agregará aquí dinámicamente.


/**
 * Formatea una lista de productos de la base de datos a una tabla Markdown.
 * @param {Array<Object>} productos - Array de objetos de motocicletas desde Sequelize.
 * @returns {string} - Una tabla en formato Markdown.
 */
function formatMotorcyclesToMarkdown(productos) {
    if (!productos || productos.length === 0) {
        return "Actualmente no tenemos motocicletas en el inventario.";
    }

    let markdownTable = "| ID | Marca | Modelo | Cilindrada | Precio | Tipo | Stock |\n";
    markdownTable +=    "|----|-------|--------|------------|--------|------|-------|\n";
    productos.forEach(m => {
        const moto = m.toJSON(); // Usamos toJSON() para obtener el objeto plano de Sequelize
        markdownTable += `| ${moto.ID} | ${moto.Marca} | ${moto.Modelo} | ${moto.Cilindrada}cc | $${moto.Precio} | ${moto.Tipo} | ${moto.Stock_Disponible} |\n`;
    });
    return markdownTable;
}


async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false // El QR se manejará manualmente
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexión cerrada:', lastDisconnect.error, ', reconectando:', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('¡Conexión abierta!');
        }

        if (qr) {
            console.log("Nuevo código QR, escanéalo con tu teléfono:");
            console.log(await QRCode.toString(qr, { type: 'terminal', small: true }));
        }
    });

    // Recibir mensajes
    sock.ev.on("messages.upsert", async (event) => {
        for (const m of event.messages) {
            const remoteJid = m.key.remoteJid;

            // Ignorar mensajes propios, de grupos, estados o notificaciones
            if (event.type !== 'notify' || m.key.fromMe || !remoteJid || remoteJid.includes("@g.us") || remoteJid.includes("@broadcast")) {
                return;
            }

            const incomingMessage = m.message?.conversation || m.message?.extendedTextMessage?.text;
            if (!incomingMessage) return;

            console.log(`Mensaje recibido de ${remoteJid}: "${incomingMessage}"`);
            
            try {
                // Indicar que el bot está "escribiendo"
                await sock.sendPresenceUpdate('composing', remoteJid);
                
                // Obtener la respuesta de la IA
                const botResponse = await getGeminiResponse(incomingMessage, remoteJid);

                // Indicar que el bot ha terminado de "escribir"
                await sock.sendPresenceUpdate('paused', remoteJid);

                // Enviar la respuesta
                await sock.sendMessage(remoteJid, { text: botResponse });
                console.log(`Respuesta enviada a ${remoteJid}: "${botResponse}"`);

            } catch (error) {
                console.error("Error al procesar el mensaje:", error);
                await sock.sendMessage(remoteJid, { text: "Lo siento, estoy teniendo problemas técnicos. Por favor, intenta de nuevo en un momento." });
            }
        }
    });
}

/**
 * Obtiene una respuesta de la API de Gemini.
 * @param {string} userMessage - El mensaje del usuario.
 * @param {string} userId - El ID del usuario (remoteJid).
 * @returns {Promise<string>} - La respuesta del bot.
 */
async function getGeminiResponse(userMessage, userId) {
    // 1. Obtener los datos actualizados de la base de datos
    const motocicletas = await Producto.findAll({ where: { Stock_Disponible: { [require('sequelize').Op.gt]: 0 } } });
    const catalogoMarkdown = formatMotorcyclesToMarkdown(motocicletas);

    // 2. Construir el prompt completo del sistema
    const fullSystemPrompt = SYSTEM_PROMPT + catalogoMarkdown;

    // 3. Gestionar el historial de la conversación
    if (!chatHistories[userId]) {
        // Si es un nuevo usuario, inicializamos su historial con el prompt del sistema
        chatHistories[userId] = [
            { role: "user", parts: [{ text: fullSystemPrompt }] },
            { role: "model", parts: [{ text: "¡Entendido! Soy MotoAsesor. ¿En qué puedo ayudarte hoy?" }] },
        ];
    }

    // 4. Iniciar el chat con Gemini
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const chat = model.startChat({
        history: chatHistories[userId],
        generationConfig: {
            maxOutputTokens: 500, // Ajusta según necesites
        },
    });

    // 5. Enviar el nuevo mensaje del usuario
    const result = await chat.sendMessage(userMessage);
    const botResponse = result.response.text();

    // 6. Actualizar el historial con el último intercambio
    chatHistories[userId].push({ role: "user", parts: [{ text: userMessage }] });
    chatHistories[userId].push({ role: "model", parts: [{ text: botResponse }] });

    return botResponse;
}

// Iniciar la conexión
connectToWhatsApp();
