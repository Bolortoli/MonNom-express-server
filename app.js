// import axios from "axios";
// import createError from "http-errors";
// // var createError = require("http-errors");
// import express from "express";
// import {} from "module";
// // var express = require("express");
// // var path = require("path");
// // var cookieParser = require("cookie-parser");
// // var logger = require("morgan");

// // var indexRouter = require("./routes/index");
// // var usersRouter = require("./routes/users");

import indexRouter from "./routes/index.js";
import express from "express";
const app = express();
const port = 3001;
import axios from "axios";
import bodyParser from "body-parser";
import cors from "cors";

// var app = express();

// // view engine setup
// app.set("views", path.join(__dirname, "views"));
// app.set("view engine", "pug");

// app.use(logger("dev"));
// app.use(express.json());
// app.use(express.urlencoded({ extended: false }));
app.use(cors());
app.use(bodyParser.json());
app.use(
	bodyParser.urlencoded({
		extended: true,
	})
);
app.use(bodyParser.raw({ type: "*/*" }));
// app.use(bodyParser.raw());
// app.use(cookieParser());
// app.use(express.static(path.join(__dirname, "public")));

// app.use("/", indexRouter);
// app.use("/users", usersRouter);

// // catch 404 and forward to error handler
// app.use(function (req, res, next) {
// 	next(createError(404));
// });

// // error handler
// app.use(function (err, req, res, next) {
// 	// set locals, only providing error in development
// 	res.locals.message = err.message;
// 	res.locals.error = req.app.get("env") === "development" ? err : {};

// 	// render the error page
// 	res.status(err.status || 500);
// 	res.render("error");
// });

// module.exports = app;
// import { login } from "./authentication";

function login(req, res) {
	let response = null;
	// console.log(req);
	axios
		.post("http://127.0.0.1:1337/auth/local", {
			identifier: "admin",
			password: "adminadmin",
		})
		.then((res) => {
			// response = res;
			console.log(res.data);
		})
		.catch((err) => {
			console.log(err);
			// response = err;
		});
	// console.log(response);
}

app.post("/admin-login", async (req, res) => {
	// let response = null;
	// console.log(req.params);
	await axios
		.post("http://127.0.0.1:1337/auth/local", {
			identifier: req.body.identifier,
			password: req.body.password,
		})
		.then((response) => {
			console.log("got fcken success");
			console.log(response.data);
			res.send(response.data);
			// response = res;
		})
		.catch((err) => {
			console.log(err);
			res.send({ response: "error" });
			// response = err;
		});
	// console.log("req.body");
	console.log(req.body);
	// login(req, res);
	// res.send(req.body);
});

app.listen(port, () => {
	console.log(`Example app listening at http://localhost:${port}`);
});
