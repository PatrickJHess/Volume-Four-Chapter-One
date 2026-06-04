# Financial Python

## Volume: Pricing And Interest Rate Risk

### Chapter One: Accessing Data With API Keys-Getting Data From FRED

#### Overcoming Data Access Barriers in the Classroom


It is our view that data is the key to understanding financial concepts and models. Fortunately, there is an abundance of real-world data available on the web. Getting that data, however, can be difficult. There are two major pain points that are particularly troublesome in a classroom setting:

* **`Authentication Barriers:`** Almost all data that could be described as "professional-grade" can only be accessed by verified accounts requiring API keys.  
* **`Rate Limits:`** Accessing this data, especially through "freemium" tiers, strictly limits the number of API requests a user can make within a specified time period.

If students do not have their API keys immediately at hand, they are unable to participate in the learning process. Even if they do have their keys, it is easy to imagine scenarios where students repeatedly execute code while building and testing models. The problem is that they can quickly burn through their API limits for the next few minutes, hours, or days, losing timely access to required data entirely.

This chapter addresses both of these problems.

First, we introduce a secure API management process that makes acquiring and accessing an API key a once-and-done process. Once a student acquires and enters an API key, it is kept private but remains readily available to their notebooks. Activation requires just a single click. This is a streamlined process that works seamlessly in both Jupyter Lab and Google Colab environments.

Second, the rate-limiting problem is solved by caching data and catching HTTP 429 (Too Many Requests) errors. If required data triggers fresh API requests on every code execution, limits will soon put the brakes on the learning process. Caching prevents this, and it also avoids overloading external servers or triggering automated blocks from sites that mistake repeated student requests for unwanted bot access.

Both of these solutions work perfectly for students working independently on their own machines, but they are particularly powerful when an entire class is working jointly on a JupyterHub. In those instances, keys can be securely embedded in the hub, and the data cache can be shared across all students who have access. Cache sharing becomes an incredibly efficient tool when a whole classroom of students is working with the exact same datasets.

In this chapter, these solutions are demonstrated using the Federal Reserve Economic Database (FRED). FRED is utilized in other chapters of this volume, and because it is completely free, it provides an excellent environment for students to get comfortable making API calls. Although FRED is forgiving, future volumes will rely on "freemium" data sources with strict rate limits, making secure API management a critical skill worth practicing now.
