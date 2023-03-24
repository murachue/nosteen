import { ErrorResponse } from "@remix-run/router";
import { useRouteError } from "react-router";
import { Link } from "react-router-dom";

const ErrorPage = () => {
    const err = useRouteError();
    console.error(err);

    if (err instanceof ErrorResponse && err.status === 404) {
        return <div>
            404... <Link to="/">Go back to top.</Link>
        </div>;
    }

    return <div>
        oops: {(err as any).statusText || (err as any).message}
    </div>;
};

export default ErrorPage;
