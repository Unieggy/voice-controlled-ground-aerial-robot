package com.example;

import com.theokanning.openai.service.OpenAiService;
import com.theokanning.openai.completion.chat.ChatCompletionRequest;
import com.theokanning.openai.completion.chat.ChatCompletionResult;
import com.theokanning.openai.completion.chat.ChatMessage;

import io.socket.client.IO;
import io.socket.client.Socket;
import io.socket.emitter.Emitter;

import java.net.URISyntaxException;
import java.util.Arrays;

public class ChatGPTMotorControl {
    // Updated IP to match your server's address
    private static final String NODE_SERVER_URL = "http://192.168.2.55:3001";
    private static final String OPENAI_API_KEY = ""; // Replace with your OpenAI API key

    public static void main(String[] args) throws URISyntaxException {
        OpenAiService openAiService = new OpenAiService(OPENAI_API_KEY);

        Socket socket = IO.socket(NODE_SERVER_URL);
        socket.on(Socket.EVENT_CONNECT_ERROR, new Emitter.Listener() {
            @Override
            public void call(Object... args) {
                System.err.println("Connection Error: " + Arrays.toString(args));
            }
        });

        socket.on(Socket.EVENT_CONNECT, args1 -> {
            System.out.println("Connected to Node.js server.");
            socket.emit("identify", "java"); 
        });

        socket.on("processText", args1 -> {
            String receivedText = (String) args1[0];
            System.out.println("Received text from Node.js: " + receivedText);
            String response = processWithChatGPT(openAiService, receivedText);
            System.out.println("Response from ChatGPT: " + response);
            socket.emit("chatgptResponse", response);
        });

        socket.connect();
    }
    private static String processWithChatGPT(OpenAiService service, String text) {
        ChatMessage systemMessage = new ChatMessage("system",
    "Convert input to motor commands in the form <command>:<duration_ms>, " +
    "where command ∈ {move forward, move backward, turn left, turn right, stop}. " +
    "convert the duration from seconds to miliseconds.If no duration is given, default to 2000 ms. Unrecognized commands → stop:0. " +
    "If multiple actions are mentioned, chain them with semicolons, e.g.move forward 2 seconds and turn right 1 second, move forward:2000;turn right:1000."
    );

        ChatMessage userMessage = new ChatMessage("user", text);

        ChatCompletionRequest request = ChatCompletionRequest.builder()
                .model("gpt-3.5-turbo")
                .messages(Arrays.asList(systemMessage, userMessage))
                .maxTokens(30)
                .temperature(0.0)
                .build();

        ChatCompletionResult result = service.createChatCompletion(request);
        return result.getChoices().get(0).getMessage().getContent().trim();
    }
}
