require("dotenv").config()
const express = require("express")
const bodyParser = require("body-parser")
const RingCentral = require("@ringcentral/sdk").SDK
const WebSocket = require("ws")
const http = require("http")

const app = express()
app.use(bodyParser.json())

const PORT = process.env.PORT || 5000

const rcsdk = new RingCentral({
    server: process.env.RINGCENTRAL_SERVER_URL,
    clientId: process.env.RINGCENTRAL_CLIENT_ID,
    clientSecret: process.env.RINGCENTRAL_CLIENT_SECRET
})

const platform = rcsdk.platform()

// Create an HTTP server to be used with both Express and WebSocket
const server = http.createServer(app)

// Create a WebSocket server that works with the HTTP server
const wss = new WebSocket.Server({ server })

app.get("/", (req, res) => {
    res.send("RingCentral API Integration with JWT Authentication")
})

/* ============== RING CENTRAL SUBSCRIPTION ================== */

// JWT login route
app.get("/login", async (req, res) => {
    console.log("login api called")
    try {
        const loginResponse = await platform.login({
            jwt: process.env.RINGCENTRAL_JWT
        })

        console.log("loginResponse", JSON.stringify(loginResponse))
        res.send("Login successful with JWT!")
    } catch (error) {
        // console.log(error)
        res.send("Login failed: " + error.message)
    }
})

platform.on(platform.events.loginSuccess, function (e) {
    console.log("LOGIN SUCCESSFUL")
    // subscribe_for_notification()
    read_subscriptions()
})

platform.on(platform.events.loginError, function (e) {
    console.log(
        "Unable to authenticate to platform. Check credentials.",
        e.message
    )
    process.exit(1)
})

/* Create a Webhok notification and subscribe for instant SMS message notification */
async function subscribe_for_notification() {
    var bodyParams = {
        eventFilters: [
            "/restapi/v1.0/account/~/extension/~/presence?detailedTelephonyState=true",
            "/restapi/v1.0/account/~/telephony/sessions"
            // "/restapi/v1.0/account/~/presence",
            // "/restapi/v1.0/account/~/extension/~/telephony/sessions",
            // "/restapi/v1.0/account/~/extension/~/presence",
            // "/restapi/v1.0/account/~/extension/~/presence/line/presence",
            // "/restapi/v1.0/account/~/extension/~/presence/line",
        ],
        deliveryMode: {
            transportType: "WebHook",
            address: process.env.RINGCENTRAL_WEBHOOK_DELIVERY_ADDRESS
        },
        expiresIn: 3600 * 24 * 365
    }
    try {
        let endpoint = "/restapi/v1.0/subscription"
        var resp = await platform.post(endpoint, bodyParams)
        var jsonObj = await resp.json()
        console.log(`Subscription Id: ${jsonObj.id}`)
        console.log("Ready to receive incoming SMS via WebHook.")
    } catch (e) {
        console.log({ e, msg: e.message })
    }
}

/* Read all created subscriptions */
async function read_subscriptions() {
    try {
        let endpoint = "/restapi/v1.0/subscription"
        var resp = await platform.get(endpoint)
        var jsonObj = await resp.json()
        console.log("RESPONSE >>>", jsonObj)
        if (jsonObj.records.length == 0) {
            console.log("No subscription yet.")
            console.log("Now subscribing for SMS events.")
            subscribe_for_notification()
        } else {
            for (var record of jsonObj.records) {
                // console.log({ record })
                delete_subscription(record.id)
            }
        }
    } catch (e) {
        console.error(e.message)
    }
}

/* Read SMS subscription events (TRYING) */
// async function read_SMS_subscriptions(uri) {
//     try {
//         let endpoint = uri
//         var resp = await platform.get(endpoint)
//         var jsonObj = await resp.json()
//         console.log("SMS EVENT webhook RESPONSE >>>", jsonObj)
//     } catch (e) {
//         console.error(e.message)
//     }
// }

/* Delete a subscription identified by the subscription id */
async function delete_subscription(subscriptionId) {
    try {
        let endpoint = `/restapi/v1.0/subscription/${subscriptionId}`
        var resp = await platform.delete(endpoint)
        console.log(`Subscription ${subscriptionId} deleted.`)
    } catch (e) {
        console.log(e.message)
    }
}

/* ============== RING CENTRAL APIs & WEBHOOK ================== */

// Send SMS
app.post("/send-sms", async (req, res) => {
    try {
        const { toNumber, message } = req.body
        const resp = await platform.post(
            "/restapi/v1.0/account/~/extension/~/sms",
            {
                from: { phoneNumber: process.env.RINGCENTRAL_USERNAME },
                to: [{ phoneNumber: toNumber }],
                text: message
            }
        )
        res.json(await resp.json())
    } catch (error) {
        res.send("SMS failed: " + error.message)
    }
})

// Place a voice call
app.post("/make-call", async (req, res) => {
    try {
        const { toNumber } = req.body
        const resp = await platform.post(
            "/restapi/v1.0/account/~/extension/~/ringout",
            {
                from: { phoneNumber: process.env.RINGCENTRAL_USERNAME },
                to: { phoneNumber: toNumber },
                playPrompt: true
            }
        )

        const callInfo = await resp.json()
        console.log("Call info >>>:", callInfo)
        const sessionId = callInfo.id // Capture session ID
        console.log("Call initiated. Session ID:", sessionId)

        res.json(callInfo)
    } catch (error) {
        res.send("Call failed: " + error.message)
    }
})

// End a voice call
app.post("/end-call", async (req, res) => {
    try {
        const { sessionId } = req.body // Make sure to pass sessionId when ending the call
        const endpoint = `/restapi/v1.0/account/~/telephony/sessions/${sessionId}`

        const response = await platform.post(endpoint, {
            action: "cancel"
        })

        res.json(await response.json())
        console.log(`Call with session ID ${sessionId} has been ended.`)
    } catch (error) {
        console.error("Failed to end the call:", error)
        res.status(500).send("Error ending the call: " + error.message)
    }
})

// Webhook handler
app.post("/webhook", async (req, res) => {
    const validationToken = req.headers["validation-token"]

    // Check if the request contains a validation token
    if (validationToken) {
        console.log("Validation Token received:", validationToken)
        // Respond with the validation token
        res.setHeader("Validation-Token", validationToken)
        res.status(200).send("Validation token returned")
    } else {
        // Process the actual event (after validation is completed)
        console.log("Webhook event received:", req.body)
        console.log("\n PARTIES >>:", req.body?.body?.parties)
        res.status(200).send("Event received")
    }
})

/* ============== WEB SOCKETS ================== */

// WebSocket server logic
wss.on("connection", (ws) => {
    console.log("New WebSocket client connected")

    // Send a welcome message to the WebSocket client
    ws.send(JSON.stringify({ message: "Welcome to the WebSocket server" }))

    // Handle messages from the client
    ws.on("message", (message) => {
        console.log("Received message from client:", message)

        // Broadcast the message to all connected clients
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ message: `Echo: ${message}` }))
            }
        })
    })

    // Handle disconnection
    ws.on("close", () => {
        console.log("Client disconnected")
    })
})

// WebSocket testing route (you can use Postman with WebSocket support to test this)
app.get("/test-websocket", (req, res) => {
    // Send a message to all WebSocket clients for testing
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ message: "This is a test message" }))
        }
    })
    res.send("Test message sent to WebSocket clients.")
})

/* ============== PRO SOFTWARE ================== */

server.listen(PORT, async () => {
    console.log(`Server running at http://localhost:${PORT}`)
})
