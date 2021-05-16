import express from "express";
var indexRouter = express.Router();

/* GET home page. */
indexRouter.get("/", function (req, res, next) {
	res.render("index", { title: "Express" });
});

export default indexRouter;

// TODO delete expired files on express server file storage
const deleteFilesAfter24Hours = (req, res, next) => {
	next();
};

// TODO middleware for book
const checkIsJWTAliveForBookFiles = (req, res, next) => {
	if (req.path.split("/")[1] == "books") {
		console.log("book route");
		console.log(req.path.split("/"));
	} else {
		console.log("not file route");
		console.log(req.path.split("/"));
	}
	next();
	// if (req.path)
};

var download = function (url, dest, cb) {
	var __dirname = dirname(fileURLToPath(import.meta.url));
	__dirname = path.join(__dirname, dest);
	var file = fs.createWriteStream(__dirname);

	var request = http
		.get(url, function (response) {
			response.pipe(file);
			file.on("finish", function () {
				file.close(cb);
			});
		})
		.on("error", function (err) {
			fs.unlink(dest);
			if (cb) cb(err.message);
		});
};

app.post("/tests", upload.single("picture"), async (req, res, next) => {
	console.log(JSON.parse(req.body.data));
	console.log(req.body);
	console.log(req.file);

	const formData = new FormData();
	formData.append("data", JSON.parse(req.body.data));
	formData.append("files.picture", req.file);

	// download(
	// 	"${STRAPI_URL}/uploads/Architecture_assignment1_92df063af1.png",
	// 	"cloned_files/Architecture_asssdsaignment1_92df063af1.png",
	// 	next
	// );
	const config = {
		headers: {
			"content-type": "multipart/form-data",
			Authorization: `Bearer ${req.headers.Authorization}`,
		},
	};

	await axios
		.post(`http://127.0.0.1:3001/tests`, formData, config)
		.then((response) => {
			console.log(response.data);
		})
		.catch((err) => {
			console.log(err);
		});

	await axios({
		url: `http://127.0.0.1:3001/tests`,
		method: "POST",
		headers: {
			Authorization: req.headers.authorization,
		},
		data,
	})
		.then(async (response) => {})
		.catch((err) => {
			console.log(err);
			send400("error", res);
		});
});

// app.use(deleteFilesAfter24Hours);
// app.use(checkIsJWTAliveForBookFiles);

app.get("/books/:file_name", (req, res, next) => {
	const __dirname = dirname(fileURLToPath(import.meta.url));
	var options = {
		root: path.join(__dirname, "uploads"),
	};
	// res.send({ file: `${req.params.file_name} + ${__dirname}` });
	const file_name = req.params.file_name;
	res.sendFile(file_name, options, (err) => {
		if (err) {
			next(err);
		} else {
			console.log(`sent that mofoker: ${file_name}`);
			next();
		}
	});
});

app.post("/podcast-upload", async (req, res, next) => {
	// console.log(JSON.parse(req.body.data));
	console.log(req.body);
	res.send(req.body);
});
