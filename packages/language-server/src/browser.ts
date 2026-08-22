import {
  BrowserMessageReader,
  BrowserMessageWriter,
  createConnection,
} from "vscode-languageserver/browser";
import { startLanguageServer } from "./server.js";

startLanguageServer(
  createConnection(new BrowserMessageReader(self), new BrowserMessageWriter(self)),
);
