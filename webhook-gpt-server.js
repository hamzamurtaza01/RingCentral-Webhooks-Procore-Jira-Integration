require("dotenv").config()
const express = require("express")
const bodyParser = require("body-parser")
const RingCentral = require("@ringcentral/sdk").SDK
const WebSocket = require("ws")
const http = require("http")
const axios = require("axios")
const crypto = require("crypto")
const state = crypto.randomBytes(16).toString("hex")

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
        // console.log(`Subscription Id: ${jsonObj.id}`)
        // console.log("Ready to receive incoming SMS via WebHook.")
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
            // console.log("No subscription yet.")
            // console.log("Now subscribing for SMS events.")
            subscribe_for_notification()
        } else {
            for (var record of jsonObj.records) {
                console.log({ record })
                // delete_subscription(record.id)
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

// Step 1: Redirect User to ProCore OAuth Login
app.get("/procore/login", (req, res) => {
    console.log("unique state >>>", state)
    const procoreAuthUrl = `https://login-sandbox.procore.com/oauth/authorize?client_id=${process.env.PROCORE_CLIENT_ID}&response_type=code&redirect_uri=${process.env.PROCORE_REDIRECT_URI}&scope=users.read+users.write+projects.read+projects.write+read.users+write.users+read.projects+write.projects&state=${state}`
    console.log(
        "Redirecting to ProCore login with procoreAuthUrl:",
        procoreAuthUrl
    )
    res.redirect(procoreAuthUrl)
})

// Step 2: Handle OAuth Callback and Retrieve Authorization Code
app.get("/procore/callback", async (req, res) => {
    console.log("ProCore callback received with query >>>>>>>:", req.query)
    const authCode = req.query.code // Extract the authorization code from the query parameter
    if (!authCode) {
        return res.status(400).send("Authorization code not found")
    }

    try {
        // Step 3: Exchange the authorization code for an access token
        const tokenResponse = await axios.post(
            "https://api.procore.com/oauth/token",
            null,
            {
                params: {
                    grant_type: "authorization_code",
                    client_id: process.env.PROCORE_CLIENT_ID,
                    client_secret: process.env.PROCORE_CLIENT_SECRET,
                    code: authCode,
                    redirect_uri: process.env.PROCORE_REDIRECT_URI
                },
                headers: { "Content-Type": "application/x-www-form-urlencoded" }
            }
        )

        const { access_token, refresh_token } = tokenResponse.data

        console.log("Access Token:", access_token)
        console.log("Refresh Token:", refresh_token)

        // Store tokens securely for future API requests (could store in DB or session)
        // Respond with success or redirect to the frontend
        res.send("ProCore login successful!")
    } catch (error) {
        console.error("Error fetching ProCore tokens:", error)
        res.status(500).send("Error fetching tokens: " + error.message)
    }
})

// Step 4: Use the Access Token to Interact with ProCore APIs
app.get("/procore/users", async (req, res) => {
    const accessToken = 111111 /* Retrieve stored access token from session or database */

    try {
        const response = await axios.get(
            process.env.PROCORE_API_URL + "/vapid/users",
            {
                headers: { Authorization: `Bearer ${accessToken}` }
            }
        )

        res.json(response.data) // Send user data to client
    } catch (error) {
        console.error("Error fetching ProCore users:", error)
        res.status(500).send("Error fetching users: " + error.message)
    }
})

// OLD CODE

// Step 1: Authenticate and get access token
app.post("/procore/auth", async (req, res) => {
    const { authCode } = req.body

    try {
        const accessToken = await getAccessToken(authCode)
        res.status(200).json({ accessToken })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

async function getAccessToken(authCode) {
    try {
        const response = await axios.post(
            process.env.PROCORE_API_URL + "/oauth/token",
            null,
            {
                params: {
                    grant_type: "authorization_code",
                    code: authCode,
                    client_id: process.env.PROCORE_CLIENT_ID,
                    client_secret: process.env.PROCORE_CLIENT_SECRET,
                    redirect_uri: process.env.PROCORE_REDIRECT_URI
                }
            }
        )
        const { access_token, refresh_token } = response.data

        console.log("Access Token:", access_token)
        console.log("Refresh Token:", refresh_token)

        return response.data.access_token
    } catch (error) {
        console.error("Error getting access token:", error.response.data)
        throw new Error("Failed to obtain access token.")
    }
}

// Step 2: Fetch users
async function fetchUsers(accessToken) {
    try {
        const response = await axios.get(
            process.env.PROCORE_API_URL + "/vapid/users",
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            }
        )
        return response.data.data // Modify according to actual API response structure
    } catch (error) {
        console.error("Error fetching users:", error.response.data)
        throw new Error("Failed to fetch users.")
    }
}

// Step 3: Add a note for a user
async function addNoteForUser(accessToken, userId, noteContent) {
    try {
        const response = await axios.post(
            `${process.env.PROCORE_API_URL}/vapid/users/${userId}/notes`,
            {
                content: noteContent,
                type: "note"
            },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            }
        )
        return response.data // Modify according to actual API response structure
    } catch (error) {
        console.error("Error adding note:", error.response.data)
        throw new Error("Failed to add note.")
    }
}

// Step 4: Edit a note for a user
async function editNoteForUser(accessToken, userId, noteId, updatedContent) {
    try {
        const response = await axios.put(
            `${process.env.PROCORE_API_URL}/vapid/users/${userId}/notes/${noteId}`,
            {
                content: updatedContent
            },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            }
        )
        return response.data // Modify according to actual API response structure
    } catch (error) {
        console.error("Error editing note:", error.response.data)
        throw new Error("Failed to edit note.")
    }
}

// Example route to handle the authentication and note management
app.post("/procore", async (req, res) => {
    const { authCode, userId, noteContent, noteId } = req.body

    try {
        const accessToken = await getAccessToken(authCode)
        console.log("Access Token:", accessToken)
        const users = await fetchUsers(accessToken)
        console.log("Fetched Users:", users)

        const addedNote = await addNoteForUser(accessToken, userId, noteContent)
        console.log("Added Note:", addedNote)

        if (noteId) {
            const updatedNote = await editNoteForUser(
                accessToken,
                userId,
                noteId,
                "Updated Note Content"
            )
            console.log("Updated Note:", updatedNote)
        }

        res.status(200).json({ users, addedNote })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

/* ================================================ */

server.listen(PORT, async () => {
    console.log(`Server running at http://localhost:${PORT}`)
})
