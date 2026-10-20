import mongoose from "mongoose";
import beautifyUnique from "mongoose-beautiful-unique-validation";
import config from "config";

mongoose.set("debug", true);
mongoose.connect(config.get("mongodb.uri"));
mongoose.plugin(beautifyUnique);

export default mongoose;
